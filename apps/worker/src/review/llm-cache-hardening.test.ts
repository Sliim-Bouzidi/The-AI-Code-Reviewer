import { describe, expect, it } from 'vitest';
import type { LlmProvider } from '@codereview/llm';
import type { CustomRule, SemgrepAlert, Strictness } from '@codereview/shared';
import type { DiffFile } from './diff.js';
import type { CacheEntry, LlmCacheStore } from './llm-cache.js';
import { computeFileContentHash, createCacheKey, createSyntheticFileCacheKey, estimateSavedCostUsd, InMemoryLlmCacheStore } from './llm-cache.js';
import { reviewBatches } from './llm-review.js';

function createMockLlm(name = 'mock-provider', model = 'mock-model-v1', mockHandler?: (prompt: string) => any): LlmProvider {
  return {
    name,
    model,
    async generate({ prompt }) {
      if (mockHandler) {
        const res = mockHandler(prompt);
        return {
          text: typeof res === 'string' ? res : JSON.stringify(res.data ?? res),
          tokensIn: res.tokensIn ?? 100,
          tokensOut: res.tokensOut ?? 50,
        };
      }
      return {
        text: JSON.stringify({
          summary: 'Mock review summary',
          findings: [],
          semgrep_decisions: [],
        }),
        tokensIn: 100,
        tokensOut: 50,
      };
    },
  };
}

const fileA: DiffFile = {
  path: 'src/auth.ts',
  status: 'modified',
  oldPath: 'src/auth.ts',
  binary: false,
  addedLines: new Set([10, 11, 12]),
  commentableLines: new Set([10, 11, 12]),
  hunks: [
    {
      header: '@@ -10,3 +10,3 @@',
      oldStart: 10,
      newStart: 10,
      lines: ['+const secret = "hardcoded_secret";'],
    },
  ],
};

const sampleAlert: SemgrepAlert = {
  id: 'semgrep-auth-10-1',
  ruleId: 'hardcoded-secret',
  filePath: 'src/auth.ts',
  lineStart: 10,
  lineEnd: 12,
  severity: 'critical',
  category: 'security',
  message: 'Hardcoded secret detected',
};

describe('Audit & Hardening: Cache Validity, Escalation & Cost Accounting', () => {
  describe('1. Validité du cache (Cache Key Semantic Integrity)', () => {
    it('Modification de customRules provoque un cache miss', async () => {
      const rulesA: CustomRule[] = [{ rule: 'Must check auth token', severity: 'high' }];
      const rulesB: CustomRule[] = [{ rule: 'Must check CSRF header', severity: 'high' }];

      const keyA = createCacheKey({
        targetedContext: 'context',
        alert: sampleAlert,
        tier: 1,
        provider: 'economic',
        model: 'v1',
        rules: rulesA,
        strictness: 'medium',
      });

      const keyB = createCacheKey({
        targetedContext: 'context',
        alert: sampleAlert,
        tier: 1,
        provider: 'economic',
        model: 'v1',
        rules: rulesB,
        strictness: 'medium',
      });

      expect(keyA).not.toBe(keyB);
    });

    it('Modification de strictness provoque un cache miss', async () => {
      const keyLow = createCacheKey({
        targetedContext: 'context',
        alert: sampleAlert,
        tier: 1,
        provider: 'economic',
        model: 'v1',
        strictness: 'low',
      });

      const keyHigh = createCacheKey({
        targetedContext: 'context',
        alert: sampleAlert,
        tier: 1,
        provider: 'economic',
        model: 'v1',
        strictness: 'high',
      });

      expect(keyLow).not.toBe(keyHigh);
    });

    it('Modification de escalationPolicy provoque un cache miss', async () => {
      const keyPolicyA = createCacheKey({
        targetedContext: 'context',
        alert: sampleAlert,
        tier: 1,
        provider: 'economic',
        model: 'v1',
        escalationPolicy: { escalateOnUncertain: true },
      });

      const keyPolicyB = createCacheKey({
        targetedContext: 'context',
        alert: sampleAlert,
        tier: 1,
        provider: 'economic',
        model: 'v1',
        escalationPolicy: { escalateOnUncertain: false },
      });

      expect(keyPolicyA).not.toBe(keyPolicyB);
    });
  });

  describe('2. Respect de l\'escalade Tier 2 (Escalation Guarantees)', () => {
    it('Une alerte critique avec Tier 1 en cache déclenche TOUJOURS l\'escalade Tier 2', async () => {
      let tier2Executed = false;
      const mockEconomic = createMockLlm('economic', 'v1', () => ({
        data: {
          summary: 'Triage',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Triage confirmed' }],
        },
      }));

      const mockPowerful = createMockLlm('powerful', 'v2', () => {
        tier2Executed = true;
        return {
          data: {
            summary: 'Deep check',
            findings: [],
            semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Deep check confirmed' }],
          },
        };
      });

      const cacheStore = new InMemoryLlmCacheStore();

      // Run 1: Populates Tier 1 cache
      await reviewBatches(
        [mockEconomic],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert], // Critical severity alert
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true, powerfulLlm: [mockPowerful], escalationPolicy: { escalateOnHighSeverity: true } },
      );

      expect(tier2Executed).toBe(true);

      // Reset flag
      tier2Executed = false;

      // Run 2: Tier 1 hits cache, BUT Critical severity alert MUST STILL escalate to Tier 2!
      const res2 = await reviewBatches(
        [mockEconomic],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert],
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true, powerfulLlm: [mockPowerful], escalationPolicy: { escalateOnHighSeverity: true } },
      );

      expect(res2.metrics.tier1CacheHits).toBe(1);
      expect(res2.metrics.tier2CacheHits).toBe(1); // Tier 2 escalation was performed and served from Tier 2 cache!
      expect(res2.findings[0]!.semgrepDecision).toBe('CONFIRMED');
    });

    it('En cas d\'échec du fournisseur Tier 2, l\'alerte incertaine est conservée (fallbackAlerts)', async () => {
      const mockEconomic = createMockLlm('economic', 'v1', () => ({
        data: {
          summary: 'Triage',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'UNCERTAIN', reason: 'Uncertain triage' }],
        },
      }));

      const failingPowerful: LlmProvider = {
        name: 'failing-powerful',
        model: 'v2-timeout',
        async generate() {
          throw new Error('504 Gateway Timeout on Tier 2');
        },
      };

      const cacheStore = new InMemoryLlmCacheStore();

      const res = await reviewBatches(
        [mockEconomic],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert],
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true, powerfulLlm: [failingPowerful], escalationPolicy: { escalateOnUncertain: true } },
      );

      // Alert is retained as UNCERTAIN, never dropped
      expect(res.findings).toHaveLength(1);
      expect(res.findings[0]!.semgrepDecision).toBe('UNCERTAIN');
      expect(res.findings[0]!.semgrepReason).toContain('Tier-2 LLM evaluation failed or timed out');
      expect(res.metrics.fallbackAlerts).toBe(1);
    });
  });

  describe('3. Traçabilité des tokens et des coûts (Token & Cost Accounting)', () => {
    it('Les tokens réseau réels (tokensIn/Out) ne double-comptent pas les tokens économisés (savedTokens)', async () => {
      const mockLlm = createMockLlm('economic', 'v1', () => ({
        data: {
          summary: 'Triage',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Confirmed' }],
        },
        tokensIn: 250,
        tokensOut: 80,
      }));

      const cacheStore = new InMemoryLlmCacheStore();

      // Run 1: Cache Miss (250 tokens in, 80 tokens out)
      const res1 = await reviewBatches(
        [mockLlm],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert],
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true, escalationPolicy: { escalateOnHighSeverity: false } },
      );

      expect(res1.metrics.tokensIn).toBe(250);
      expect(res1.metrics.tokensOut).toBe(80);
      expect(res1.metrics.savedTokensIn).toBe(0);
      expect(res1.metrics.savedTokensOut).toBe(0);

      // Run 2: Cache Hit (0 real tokensIn/Out, 250 savedTokensIn, 80 savedTokensOut)
      const res2 = await reviewBatches(
        [mockLlm],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert],
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true, escalationPolicy: { escalateOnHighSeverity: false } },
      );

      // Real network tokens consumed on hit MUST BE ZERO
      expect(res2.metrics.tokensIn).toBe(0);
      expect(res2.metrics.tokensOut).toBe(0);

      // Counterfactual saved tokens
      expect(res2.metrics.savedTokensIn).toBe(250);
      expect(res2.metrics.savedTokensOut).toBe(80);
      expect(res2.metrics.avoidedLlmCalls).toBe(1);
    });

    it('Calcul précis de estimatedSavedCostUsd sur les cache hits', () => {
      const savedIn = 1_000_000;
      const savedOut = 500_000;

      const cost = estimateSavedCostUsd(savedIn, savedOut);
      // 1M * 0.15 = 0.15, 0.5M * 0.60 = 0.30 -> Total 0.45
      expect(cost).toBe(0.45);
    });
  });

  describe('4. Synchronisation des écritures de cache et tolérance aux pannes (Slow Writes & Fault Isolation)', () => {
    it('Les écritures lentes (slow writes) sont attendues avant la fin de reviewBatches (pas de race condition)', async () => {
      let writeCompleted = false;
      let writeDurationMs = 0;

      const slowCacheStore: LlmCacheStore = {
        async get() {
          return null;
        },
        async set() {
          const start = Date.now();
          await new Promise((resolve) => setTimeout(resolve, 80));
          writeDurationMs = Date.now() - start;
          writeCompleted = true;
        },
      };

      const mockLlm = createMockLlm('economic', 'v1', () => ({
        data: {
          summary: 'Triage with slow cache',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Confirmed by triage' }],
        },
      }));

      const res = await reviewBatches(
        [mockLlm],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert],
        new Map(),
        [],
        'medium',
        { cacheStore: slowCacheStore, enableCache: true, escalationPolicy: { escalateOnHighSeverity: false } },
      );

      // S'assurer que le review ne s'est pas terminé avant la fin de l'écriture
      expect(writeCompleted).toBe(true);
      expect(writeDurationMs).toBeGreaterThanOrEqual(70);
      expect(res.metrics.cacheErrors).toBe(0);
      expect(res.findings).toHaveLength(1);
      expect(res.findings[0]!.semgrepDecision).toBe('CONFIRMED');
    });

    it('Une exception ou un rejet asynchrone dans cacheStore.set() n’interrompt pas la revue et incrémente cacheErrors', async () => {
      const rejectingCacheStore: LlmCacheStore = {
        async get() {
          return null;
        },
        async set() {
          throw new Error('Database connection reset during cache store write');
        },
      };

      const mockLlm = createMockLlm('economic', 'v1', () => ({
        data: {
          summary: 'Triage with failing cache write',
          findings: [
            {
              file: 'src/auth.ts',
              line_start: 10,
              severity: 'critical',
              category: 'security',
              message: 'Direct LLM finding',
              confidence: 0.9,
            },
          ],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Confirmed by triage' }],
        },
      }));

      // Ne doit pas lever d'erreur
      const res = await reviewBatches(
        [mockLlm],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert],
        new Map(),
        [],
        'medium',
        { cacheStore: rejectingCacheStore, enableCache: true, escalationPolicy: { escalateOnHighSeverity: false } },
      );

      // La revue doit réussir avec l'ensemble des résultats intacts
      expect(res.summary).toBe('Triage with failing cache write');
      expect(res.findings).toHaveLength(2); // 1 LLM finding + 1 confirmed semgrep finding
      expect(res.findings.find((f) => f.ruleId === 'hardcoded-secret')?.semgrepDecision).toBe('CONFIRMED');
      // L'erreur de cache doit être comptabilisée sans bloquer la revue
      expect(res.metrics.cacheErrors).toBe(1);
    });

    it('Une erreur synchrone dans cacheStore.set() est également capturée sans interrompre la revue', async () => {
      const synchronousThrowStore: LlmCacheStore = {
        async get() {
          return null;
        },
        set() {
          throw new Error('Synchronous serialization error in cacheStore.set');
        },
      };

      const mockLlm = createMockLlm('economic', 'v1', () => ({
        data: {
          summary: 'Triage with synchronous error',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'REJECTED', reason: 'False positive' }],
        },
      }));

      const res = await reviewBatches(
        [mockLlm],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert],
        new Map(),
        [],
        'medium',
        { cacheStore: synchronousThrowStore, enableCache: true, escalationPolicy: { escalateOnHighSeverity: false } },
      );

      expect(res.findings).toHaveLength(1);
      expect(res.findings[0]!.semgrepDecision).toBe('REJECTED');
      expect(res.metrics.cacheErrors).toBe(1);
    });

    it('Les écritures lentes lors de l’escalade Tier-2 sont attendues et préservent la synchronisation', async () => {
      let tier2WriteCompleted = false;

      const mockEconomic = createMockLlm('economic', 'v1', () => ({
        data: {
          summary: 'Economic triage unsure',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'UNCERTAIN', reason: 'Need senior model' }],
        },
      }));

      const mockPowerful = createMockLlm('powerful', 'v2', () => ({
        data: {
          summary: 'Powerful model confirmation',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Confirmed by powerful' }],
        },
      }));

      const slowTier2Store: LlmCacheStore = {
        async get() {
          return null;
        },
        async set(_key, entry) {
          if (entry.tier === 2) {
            await new Promise((resolve) => setTimeout(resolve, 60));
            tier2WriteCompleted = true;
          }
        },
      };

      const res = await reviewBatches(
        [mockEconomic],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert],
        new Map(),
        [],
        'medium',
        {
          cacheStore: slowTier2Store,
          enableCache: true,
          powerfulLlm: [mockPowerful],
          escalationPolicy: { escalateOnUncertain: true },
        },
      );

      expect(tier2WriteCompleted).toBe(true);
      expect(res.findings[0]!.semgrepDecision).toBe('CONFIRMED');
      expect(res.metrics.tier2Calls).toBe(1);
      expect(res.metrics.cacheErrors).toBe(0);
    });
  });

  describe('5. Mise en cache des éléments synthétiques (Synthetic File Items Caching & Isolation)', () => {
    const fileSynthA: DiffFile = {
      path: 'src/utils/math.ts',
      status: 'modified',
      oldPath: 'src/utils/math.ts',
      binary: false,
      addedLines: new Set([1, 2]),
      commentableLines: new Set([1, 2]),
      hunks: [
        {
          header: '@@ -1,2 +1,2 @@',
          oldStart: 1,
          newStart: 1,
          lines: ['+export function add(a: number, b: number): number {', '+  return a + b;', '+}'],
        },
      ],
    };

    const fileSynthB: DiffFile = {
      path: 'src/utils/logger.ts',
      status: 'modified',
      oldPath: 'src/utils/logger.ts',
      binary: false,
      addedLines: new Set([10]),
      commentableLines: new Set([10]),
      hunks: [
        {
          header: '@@ -10,1 +10,1 @@',
          oldStart: 10,
          newStart: 10,
          lines: ['+export const log = (msg: string) => console.log(msg);'],
        },
      ],
    };

    it('Clé de cache stable et sensible aux modifications de contenu (computeFileContentHash & createSyntheticFileCacheKey)', () => {
      const hash1 = computeFileContentHash('console.log("v1");', fileSynthA);
      const hash2 = computeFileContentHash('console.log("v2");', fileSynthA);
      const hash3 = computeFileContentHash('console.log("v1");', fileSynthA);

      expect(hash1).toBe(hash3);
      expect(hash1).not.toBe(hash2);

      const keyA = createSyntheticFileCacheKey({
        filePath: 'src/utils/math.ts',
        fileContentHash: hash1,
        targetedContext: 'ctx1',
        provider: 'mock-provider',
        model: 'mock-model',
      });

      const keyB = createSyntheticFileCacheKey({
        filePath: 'src/utils/logger.ts',
        fileContentHash: hash1,
        targetedContext: 'ctx1',
        provider: 'mock-provider',
        model: 'mock-model',
      });

      const keyAUpdated = createSyntheticFileCacheKey({
        filePath: 'src/utils/math.ts',
        fileContentHash: hash2,
        targetedContext: 'ctx1',
        provider: 'mock-provider',
        model: 'mock-model',
      });

      // Différents chemins produisent des clés différentes
      expect(keyA).not.toBe(keyB);
      // Modification du contenu produit une clé différente (évite tout résultat obsolète)
      expect(keyA).not.toBe(keyAUpdated);
    });

    it('Cache Hit complet sur fichier synthétique (sans appel LLM et conservation des findings)', async () => {
      let llmCalls = 0;
      const mockLlm = createMockLlm('economic', 'v1', () => {
        llmCalls++;
        return {
          data: {
            summary: 'Math util review',
            findings: [
              {
                file: 'src/utils/math.ts',
                line_start: 1,
                severity: 'low',
                category: 'style',
                message: 'Consider adding JSDoc comments',
                confidence: 0.85,
              },
            ],
            semgrep_decisions: [],
          },
          tokensIn: 150,
          tokensOut: 60,
        };
      });

      const cacheStore = new InMemoryLlmCacheStore();
      const fileContents = new Map<string, string>([
        ['src/utils/math.ts', 'export function add(a: number, b: number): number { return a + b; }'],
      ]);

      // Run 1: Cache Miss -> Exécution LLM et persistance dans le cache
      const res1 = await reviewBatches(
        [mockLlm],
        [fileSynthA],
        fileContents,
        new Map(),
        [], // Aucune alerte Semgrep -> élément synthétique
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true },
      );

      expect(llmCalls).toBe(1);
      expect(res1.metrics.cacheHits).toBe(0);
      expect(res1.metrics.cacheMisses).toBe(1);
      expect(res1.metrics.tokensIn).toBe(150);
      expect(res1.metrics.tokensOut).toBe(60);
      expect(res1.findings).toHaveLength(1);
      expect(res1.findings[0]!.filePath).toBe('src/utils/math.ts');
      expect(res1.findings[0]!.message).toBe('Consider adding JSDoc comments');

      // Run 2: Cache Hit -> LLM non appelé (0 tokens consommés, savedTokens enregistrés)
      const res2 = await reviewBatches(
        [mockLlm],
        [fileSynthA],
        fileContents,
        new Map(),
        [],
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true },
      );

      expect(llmCalls).toBe(1); // Aucun appel LLM supplémentaire !
      expect(res2.metrics.cacheHits).toBe(1);
      expect(res2.metrics.tier1CacheHits).toBe(1);
      expect(res2.metrics.avoidedLlmCalls).toBe(1);
      expect(res2.metrics.tokensIn).toBe(0);
      expect(res2.metrics.tokensOut).toBe(0);
      expect(res2.metrics.savedTokensIn).toBe(150);
      expect(res2.metrics.savedTokensOut).toBe(60);
      expect(res2.findings).toHaveLength(1);
      expect(res2.findings[0]!.filePath).toBe('src/utils/math.ts');
      expect(res2.findings[0]!.message).toBe('Consider adding JSDoc comments');
    });

    it('Une modification de contenu sur un fichier synthétique provoque un cache miss (invalidation garantie)', async () => {
      let llmCalls = 0;
      const mockLlm = createMockLlm('economic', 'v1', () => {
        llmCalls++;
        return {
          data: {
            summary: `Review #${llmCalls}`,
            findings: [],
            semgrep_decisions: [],
          },
          tokensIn: 100,
          tokensOut: 40,
        };
      });

      const cacheStore = new InMemoryLlmCacheStore();
      const fileContents = new Map<string, string>([['src/utils/math.ts', 'const v1 = 1;']]);

      // Run 1: v1
      const res1 = await reviewBatches([mockLlm], [fileSynthA], fileContents, new Map(), [], new Map(), [], 'medium', {
        cacheStore,
        enableCache: true,
      });
      expect(llmCalls).toBe(1);
      expect(res1.metrics.cacheMisses).toBe(1);

      // Run 2: v1 (Cache Hit)
      const res2 = await reviewBatches([mockLlm], [fileSynthA], fileContents, new Map(), [], new Map(), [], 'medium', {
        cacheStore,
        enableCache: true,
      });
      expect(llmCalls).toBe(1);
      expect(res2.metrics.cacheHits).toBe(1);

      // Run 3: Modification du contenu du fichier
      fileContents.set('src/utils/math.ts', 'const v2 = 2; // modified content');
      const res3 = await reviewBatches([mockLlm], [fileSynthA], fileContents, new Map(), [], new Map(), [], 'medium', {
        cacheStore,
        enableCache: true,
      });
      expect(llmCalls).toBe(2); // Nouvel appel LLM déclenché
      expect(res3.metrics.cacheMisses).toBe(1);
      expect(res3.metrics.cacheHits).toBe(0);
    });

    it('Isolation stricte entre fichiers : aucun croisement des findings dans les batchs multi-fichiers', async () => {
      const mockLlm = createMockLlm('economic', 'v1', () => ({
        data: {
          summary: 'Multi-file review',
          findings: [
            {
              file: 'src/utils/math.ts',
              line_start: 1,
              severity: 'high',
              category: 'bug',
              message: 'Division by zero possible in math',
              confidence: 0.9,
            },
            {
              file: 'src/utils/logger.ts',
              line_start: 10,
              severity: 'medium',
              category: 'performance',
              message: 'Synchronous console.log in logger',
              confidence: 0.85,
            },
          ],
          semgrep_decisions: [],
        },
      }));

      const cacheStore = new InMemoryLlmCacheStore();
      const fileContents = new Map<string, string>([
        ['src/utils/math.ts', 'export function add() {}'],
        ['src/utils/logger.ts', 'export const log = () => {}'],
      ]);

      // Run 1: Batch contenant les deux fichiers
      const resBatch = await reviewBatches(
        [mockLlm],
        [fileSynthA, fileSynthB],
        fileContents,
        new Map(),
        [],
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true },
      );

      expect(resBatch.findings).toHaveLength(2);

      // Run 2: Revue ISOLÉE de fileSynthA uniquement
      const resIsolatedA = await reviewBatches(
        [mockLlm],
        [fileSynthA],
        fileContents,
        new Map(),
        [],
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true },
      );

      expect(resIsolatedA.metrics.cacheHits).toBe(1);
      // Ne doit contenir QUE le finding de math.ts, AUCUN de logger.ts
      expect(resIsolatedA.findings).toHaveLength(1);
      expect(resIsolatedA.findings[0]!.filePath).toBe('src/utils/math.ts');
      expect(resIsolatedA.findings[0]!.message).toBe('Division by zero possible in math');
      expect(resIsolatedA.findings.find((f) => f.filePath === 'src/utils/logger.ts')).toBeUndefined();

      // Run 3: Revue ISOLÉE de fileSynthB uniquement
      const resIsolatedB = await reviewBatches(
        [mockLlm],
        [fileSynthB],
        fileContents,
        new Map(),
        [],
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true },
      );

      expect(resIsolatedB.metrics.cacheHits).toBe(1);
      // Ne doit contenir QUE le finding de logger.ts, AUCUN de math.ts
      expect(resIsolatedB.findings).toHaveLength(1);
      expect(resIsolatedB.findings[0]!.filePath).toBe('src/utils/logger.ts');
      expect(resIsolatedB.findings[0]!.message).toBe('Synchronous console.log in logger');
      expect(resIsolatedB.findings.find((f) => f.filePath === 'src/utils/math.ts')).toBeUndefined();
    });
  });
});
