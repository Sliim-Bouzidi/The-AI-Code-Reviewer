import { describe, expect, it } from 'vitest';
import type { LlmProvider } from '@codereview/llm';
import type { SemgrepAlert } from '@codereview/shared';
import type { DiffFile } from './diff.js';
import { buildAlertBatches, buildBatchPrompt } from './batch-builder.js';
import { reviewBatches } from './llm-review.js';

// Helper mock LLM provider conforming to LlmProvider
function createMockLlm(name = 'mock-economic', model = 'mock-v1', mockHandler?: (prompt: string) => any): LlmProvider {
  return {
    name,
    model,
    async generate({ prompt }) {
      if (mockHandler) {
        const custom = mockHandler(prompt);
        return {
          text: typeof custom === 'string' ? custom : JSON.stringify(custom.data ?? custom),
          tokensIn: custom.tokensIn ?? 100,
          tokensOut: custom.tokensOut ?? 50,
        };
      }
      return {
        text: JSON.stringify({
          summary: 'Mock batch review summary',
          findings: [],
          semgrep_decisions: [],
        }),
        tokensIn: 100,
        tokensOut: 50,
      };
    },
  };
}

// Sample diff files
const fileA: DiffFile = {
  path: 'src/auth.ts',
  status: 'modified',
  oldPath: 'src/auth.ts',
  binary: false,
  addedLines: new Set([10, 11, 12, 25, 26, 27]),
  commentableLines: new Set([10, 11, 12, 25, 26, 27]),
  deletedLines: new Set(),
  hunks: [
    {
      header: '@@ -10,3 +10,3 @@',
      oldStart: 10,
      newStart: 10,
      lines: ['+const token = "hardcoded_jwt_secret";', ' const user = getUser();', ' return user;'],
    },
    {
      header: '@@ -25,3 +25,3 @@',
      oldStart: 25,
      newStart: 25,
      lines: ['+db.query("SELECT * FROM users WHERE id = " + id);', ' log("queried user");'],
    },
  ],
} as DiffFile;

const fileB: DiffFile = {
  path: 'src/db.ts',
  status: 'modified',
  oldPath: 'src/db.ts',
  binary: false,
  addedLines: new Set([15, 16]),
  commentableLines: new Set([15, 16]),
  deletedLines: new Set(),
  hunks: [
    {
      header: '@@ -15,2 +15,2 @@',
      oldStart: 15,
      newStart: 15,
      lines: ['+const conn = openConnection();', '+conn.query("SELECT 1");'],
    },
  ],
} as DiffFile;

const fileC: DiffFile = {
  path: 'src/utils.ts',
  status: 'modified',
  oldPath: 'src/utils.ts',
  binary: false,
  addedLines: new Set([5]),
  commentableLines: new Set([5]),
  deletedLines: new Set(),
  hunks: [
    {
      header: '@@ -5,1 +5,1 @@',
      oldStart: 5,
      newStart: 5,
      lines: ['+return a + b;'],
    },
  ],
} as DiffFile;

// Sample Semgrep alerts across files
const sampleAlerts: SemgrepAlert[] = [
  {
    id: 'semgrep-auth-10-1',
    ruleId: 'hardcoded-jwt-secret',
    filePath: 'src/auth.ts',
    lineStart: 10,
    lineEnd: 12,
    severity: 'medium',
    category: 'security',
    message: 'Hardcoded secret key in source code',
  },
  {
    id: 'semgrep-auth-25-2',
    ruleId: 'sql-injection',
    filePath: 'src/auth.ts',
    lineStart: 25,
    lineEnd: 27,
    severity: 'critical',
    category: 'security',
    message: 'Potential SQL injection vulnerability',
  },
  {
    id: 'semgrep-db-15-1',
    ruleId: 'unclosed-connection',
    filePath: 'src/db.ts',
    lineStart: 15,
    lineEnd: 16,
    severity: 'low',
    category: 'maintainability',
    message: 'Database connection is never closed',
  },
];

describe('Étape 4 — Multi-file Alert Batching & Routing', () => {
  it('1. Regroupement d\'alertes de plusieurs fichiers en un lot', async () => {
    const batches = await buildAlertBatches([fileA, fileB], new Map(), new Map(), sampleAlerts, {
      maxAlertsPerBatch: 5,
      maxBatchTokens: 6000,
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]!.items).toHaveLength(3);
    expect(batches[0]!.fileContexts.has('src/auth.ts')).toBe(true);
    expect(batches[0]!.fileContexts.has('src/db.ts')).toBe(true);
  });

  it('2. Respect du nombre maximal d\'alertes par lot (maxAlertsPerBatch)', async () => {
    const batches = await buildAlertBatches([fileA, fileB], new Map(), new Map(), sampleAlerts, {
      maxAlertsPerBatch: 2,
      maxBatchTokens: 6000,
    });

    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches[0]!.items.length).toBeLessThanOrEqual(2);
    expect(batches[1]!.items.length).toBeLessThanOrEqual(2);
  });

  it('3. Respect du budget de contexte ou de tokens (maxBatchTokens)', async () => {
    const largeContentMap = new Map<string, string>();
    largeContentMap.set('src/auth.ts', 'x'.repeat(400));
    largeContentMap.set('src/db.ts', 'y'.repeat(400));

    const batches = await buildAlertBatches([fileA, fileB], largeContentMap, new Map(), sampleAlerts, {
      maxAlertsPerBatch: 10,
      maxBatchTokens: 100, // Small token limit forces splitting items across batches
    });

    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) {
      expect(b.items.length).toBeGreaterThan(0);
    }
  });

  it('4. Traitement d\'une alerte trop volumineuse (oversized context item truncation & isolation)', async () => {
    const hugeContentMap = new Map<string, string>();
    hugeContentMap.set('src/auth.ts', 'console.log("very huge file");\n'.repeat(500));

    const batches = await buildAlertBatches([fileA], hugeContentMap, new Map(), sampleAlerts.slice(0, 1), {
      maxItemChars: 500, // Strict truncation limit per item
      maxBatchTokens: 1000,
    });

    expect(batches).toHaveLength(1);
    const context = batches[0]!.fileContexts.get('src/auth.ts');
    expect(context).toContain('context truncated to fit 500 character limit');
  });

  it('5. Association exacte des décisions aux identifiants d\'origine', async () => {
    const mockEconomic = createMockLlm('economic', 'v1', () => {
      return {
        data: {
          summary: 'Batch evaluated',
          findings: [],
          semgrep_decisions: [
            { alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Hardcoded secret verified' },
            { alert_id: 'semgrep-auth-25-2', decision: 'CONFIRMED', reason: 'SQL injection verified' },
            { alert_id: 'semgrep-db-15-1', decision: 'REJECTED', reason: 'Connection closed elsewhere' },
          ],
        },
        tokensIn: 200,
        tokensOut: 80,
      };
    });

    const res = await reviewBatches(
      [mockEconomic],
      [fileA, fileB],
      new Map(),
      new Map(),
      sampleAlerts,
      new Map(),
      [],
      'medium',
      { escalationPolicy: { escalateOnHighSeverity: false, escalateOnUncertain: false } },
    );

    expect(res.findings).toHaveLength(3);
    const authSecret = res.findings.find((f) => f.ruleId === 'hardcoded-jwt-secret');
    expect(authSecret?.semgrepDecision).toBe('CONFIRMED');
    expect(authSecret?.semgrepReason).toBe('Hardcoded secret verified');

    const dbConn = res.findings.find((f) => f.ruleId === 'unclosed-connection');
    expect(dbConn?.semgrepDecision).toBe('REJECTED');
    expect(dbConn?.semgrepReason).toBe('Connection closed elsewhere');
  });

  it('6. Gestion des alertes manquantes, inconnues et dupliquées dans la réponse', async () => {
    const mockEconomic = createMockLlm('economic', 'v1', () => {
      return {
        data: {
          summary: 'Batch evaluated with missing & unknown decisions',
          findings: [],
          semgrep_decisions: [
            { alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Confirmed 10-1' },
            { alert_id: 'unknown-alert-999', decision: 'CONFIRMED', reason: 'Unknown alert ID' },
            { alert_id: 'semgrep-auth-10-1', decision: 'REJECTED', reason: 'Duplicate decision' },
          ],
        },
        tokensIn: 150,
        tokensOut: 60,
      };
    });

    const res = await reviewBatches(
      [mockEconomic],
      [fileA, fileB],
      new Map(),
      new Map(),
      sampleAlerts,
      new Map(),
      [],
      'medium',
      { escalationPolicy: { escalateOnUncertain: false, escalateOnHighSeverity: false } },
    );

    const missingDecisionFinding = res.findings.find((f) => f.ruleId === 'sql-injection');
    expect(missingDecisionFinding?.semgrepDecision).toBe('UNCERTAIN');
    expect(res.metrics.missingAlerts).toBeGreaterThan(0);
  });

  it('7. Escalade des seules alertes qui le nécessitent vers le modèle puissant', async () => {
    let tier1Called = false;
    let tier2Called = false;

    const mockEconomic = createMockLlm('economic', 'v1', () => {
      tier1Called = true;
      return {
        data: {
          summary: 'Initial triage',
          findings: [],
          semgrep_decisions: [
            { alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Triage confirmed' },
            { alert_id: 'semgrep-auth-25-2', decision: 'UNCERTAIN', reason: 'Triage uncertain on SQLi' },
            { alert_id: 'semgrep-db-15-1', decision: 'REJECTED', reason: 'Triage rejected' },
          ],
        },
        tokensIn: 100,
        tokensOut: 40,
      };
    });

    const mockPowerful = createMockLlm('powerful', 'v2', () => {
      tier2Called = true;
      return {
        data: {
          summary: 'Tier 2 deep verification',
          findings: [],
          semgrep_decisions: [
            { alert_id: 'semgrep-auth-25-2', decision: 'CONFIRMED', reason: 'Tier 2 confirmed SQLi' },
          ],
        },
        tokensIn: 150,
        tokensOut: 50,
      };
    });

    const res = await reviewBatches(
      [mockEconomic],
      [fileA, fileB],
      new Map(),
      new Map(),
      sampleAlerts,
      new Map(),
      [],
      'medium',
      {
        powerfulLlm: [mockPowerful],
        escalationPolicy: { escalateOnUncertain: true, escalateOnHighSeverity: true },
      },
    );

    expect(tier1Called).toBe(true);
    expect(tier2Called).toBe(true);
    expect(res.metrics.escalated).toBe(true);
    expect(res.metrics.tier1Calls).toBe(1);
    expect(res.metrics.tier2Calls).toBe(1);

    const sqli = res.findings.find((f) => f.ruleId === 'sql-injection');
    expect(sqli?.semgrepDecision).toBe('CONFIRMED');
    expect(sqli?.tier1Decision).toBe('UNCERTAIN');
    expect(sqli?.tier2Decision).toBe('CONFIRMED');
  });

  it('8. Maintien des alertes en cas d\'échec du modèle puissant (Tier 2 fallback)', async () => {
    const mockEconomic = createMockLlm('economic', 'v1', () => {
      return {
        data: {
          summary: 'Triage done',
          findings: [],
          semgrep_decisions: [
            { alert_id: 'semgrep-auth-25-2', decision: 'UNCERTAIN', reason: 'Needs escalation' },
          ],
        },
        tokensIn: 100,
        tokensOut: 40,
      };
    });

    const failingPowerful: LlmProvider = {
      name: 'failing-powerful',
      model: 'v2-error',
      async generate() {
        throw new Error('API timeout on powerful LLM');
      },
    };

    const res = await reviewBatches(
      [mockEconomic],
      [fileA],
      new Map(),
      new Map(),
      [sampleAlerts[1]!],
      new Map(),
      [],
      'medium',
      { powerfulLlm: [failingPowerful] },
    );

    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]!.semgrepDecision).toBe('UNCERTAIN');
    expect(res.findings[0]!.semgrepReason).toContain('Tier-2 LLM evaluation failed or timed out');
    expect(res.metrics.fallbackAlerts).toBe(1);
  });

  it('9. Isolation des contextes de fichiers et conservation des lignes', async () => {
    const batchPrompt = buildBatchPrompt(
      {
        id: 'batch-1',
        items: [
          {
            id: 'semgrep-auth-10-1',
            filePath: 'src/auth.ts',
            ruleId: 'jwt-secret',
            severity: 'medium',
            category: 'security',
            lineStart: 10,
            lineEnd: 12,
            message: 'Secret key',
            targetedContext: '--- src/auth.ts:10-12 ---\n   10 + const secret = "key";',
            estimatedTokens: 30,
          },
          {
            id: 'semgrep-db-15-1',
            filePath: 'src/db.ts',
            ruleId: 'unclosed-conn',
            severity: 'low',
            category: 'maintainability',
            lineStart: 15,
            lineEnd: 16,
            message: 'Unclosed connection',
            targetedContext: '--- src/db.ts:15-16 ---\n   15 + const conn = open();',
            estimatedTokens: 30,
          },
        ],
        fileContexts: new Map([
          ['src/auth.ts', '--- src/auth.ts:10-12 ---\n   10 + const secret = "key";'],
          ['src/db.ts', '--- src/db.ts:15-16 ---\n   15 + const conn = open();'],
        ]),
        totalEstimatedTokens: 60,
      },
      [],
      'medium',
    );

    expect(batchPrompt).toContain('=== FILE CONTEXT: src/auth.ts ===');
    expect(batchPrompt).toContain('=== FILE CONTEXT: src/db.ts ===');
    expect(batchPrompt).toContain('[alert_id: "semgrep-auth-10-1"] File: "src/auth.ts"');
    expect(batchPrompt).toContain('[alert_id: "semgrep-db-15-1"] File: "src/db.ts"');
  });

  it('10. Rétrocompatibilité des résultats de la pipeline, API et commentaires GitHub', async () => {
    const mockEconomic = createMockLlm('economic', 'v1', () => {
      return {
        data: {
          summary: 'Clean code',
          findings: [
            {
              file: 'src/auth.ts',
              line_start: 11,
              line_end: null,
              severity: 'high',
              category: 'bug',
              message: 'Potential null pointer dereference',
              suggestion: 'Add null check',
              confidence: 0.9,
            },
          ],
          semgrep_decisions: [
            { alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Confirmed' },
          ],
        },
        tokensIn: 120,
        tokensOut: 60,
      };
    });

    const res = await reviewBatches(
      [mockEconomic],
      [fileA],
      new Map(),
      new Map(),
      [sampleAlerts[0]!],
      new Map(),
      [],
      'medium',
      { escalationPolicy: { escalateOnHighSeverity: false } },
    );

    expect(res.findings.some((f) => f.source === 'llm')).toBe(true);
    expect(res.findings.some((f) => f.source === 'semgrep')).toBe(true);
    for (const f of res.findings) {
      expect(f).toHaveProperty('filePath');
      expect(f).toHaveProperty('lineStart');
      expect(f).toHaveProperty('severity');
      expect(f).toHaveProperty('category');
      expect(f).toHaveProperty('message');
    }
  });

  it('11. Fonctionnement des revues sans alertes Semgrep (0 alertes)', async () => {
    const mockEconomic = createMockLlm('economic', 'v1', () => {
      return {
        data: {
          summary: 'Reviewed 2 files without static analysis alerts',
          findings: [],
          semgrep_decisions: [],
        },
        tokensIn: 150,
        tokensOut: 30,
      };
    });

    const res = await reviewBatches(
      [mockEconomic],
      [fileA, fileC],
      new Map(),
      new Map(),
      [],
      new Map(),
      [],
      'medium',
    );

    expect(res.summary).toBeDefined();
    expect(res.metrics.totalAlerts).toBe(0);
    expect(res.metrics.totalBatches).toBe(1);
    expect(res.metrics.tier1Calls).toBe(1);
  });

  it('12. Cohérence des métriques d\'appels, de lots, de tokens et de latence', async () => {
    const mockEconomic = createMockLlm('economic', 'v1', () => {
      return {
        data: {
          summary: 'Triage complete',
          findings: [],
          semgrep_decisions: [
            { alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'OK' },
          ],
        },
        tokensIn: 100,
        tokensOut: 40,
      };
    });

    const res = await reviewBatches(
      [mockEconomic],
      [fileA],
      new Map(),
      new Map(),
      [sampleAlerts[0]!],
      new Map(),
      [],
      'medium',
      { escalationPolicy: { escalateOnHighSeverity: false } },
    );

    expect(res.metrics.triageProvider).toBe('economic');
    expect(res.metrics.totalCalls).toBe(1);
    expect(res.metrics.totalBatches).toBe(1);
    expect(res.metrics.tokensIn).toBe(100);
    expect(res.metrics.tokensOut).toBe(40);
    expect(res.metrics.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.metrics.alertFinalStates).toHaveLength(1);
  });

  it('13. Test de comparaison (Comparative Test): Le batching réduit le nombre d\'appels LLM', async () => {
    let callCount = 0;
    const mockEconomic = createMockLlm('economic', 'v1', () => {
      callCount++;
      return {
        data: {
          summary: 'Batch call',
          findings: [],
          semgrep_decisions: sampleAlerts.map((a) => ({
            alert_id: a.id,
            decision: 'CONFIRMED' as const,
            reason: 'Batch verified',
          })),
        },
        tokensIn: 300,
        tokensOut: 100,
      };
    });

    const res = await reviewBatches(
      [mockEconomic],
      [fileA, fileB, fileC],
      new Map(),
      new Map(),
      sampleAlerts,
      new Map(),
      [],
      'medium',
      { batching: { maxAlertsPerBatch: 5 }, escalationPolicy: { escalateOnHighSeverity: false } },
    );

    const individualCallsCount = 3;
    const batchedCallsCount = callCount;

    expect(batchedCallsCount).toBe(1);
    expect(batchedCallsCount).toBeLessThan(individualCallsCount);
    expect(res.metrics.tier1Calls).toBe(1);
  });
});
