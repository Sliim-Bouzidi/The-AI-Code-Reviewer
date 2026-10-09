import { describe, expect, it } from 'vitest';
import type { LlmProvider } from '@codereview/llm';
import type { CustomRule, SemgrepAlert, Strictness } from '@codereview/shared';
import type { DiffFile } from './diff.js';
import { createCacheKey, estimateSavedCostUsd, InMemoryLlmCacheStore } from './llm-cache.js';
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
});
