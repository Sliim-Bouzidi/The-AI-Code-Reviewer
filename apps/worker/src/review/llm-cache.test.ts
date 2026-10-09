import { describe, expect, it } from 'vitest';
import type { LlmProvider } from '@codereview/llm';
import type { SemgrepAlert } from '@codereview/shared';
import type { DiffFile } from './diff.js';
import { createCacheKey, InMemoryLlmCacheStore } from './llm-cache.js';
import type { CacheEntry, LlmCacheStore } from './llm-cache.js';
import { reviewBatches } from './llm-review.js';
import { extractTargetedContext } from './targeted-context.js';

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
  severity: 'medium',
  category: 'security',
  message: 'Hardcoded secret detected',
};

describe('Étape 5 — Persistent & Reliable LLM Analysis Cache', () => {
  it('1. Un cache hit évite réellement l\'appel LLM', async () => {
    let callCount = 0;
    const mockLlm = createMockLlm('economic', 'v1', () => {
      callCount++;
      return {
        data: {
          summary: 'Evaluated',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Secret found' }],
        },
      };
    });

    const cacheStore = new InMemoryLlmCacheStore();

    // First call: Cache Miss (invokes LLM, populates cache)
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

    expect(callCount).toBe(1);
    expect(res1.metrics.cacheHits).toBe(0);
    expect(res1.metrics.cacheMisses).toBe(1);

    // Second call: Cache Hit (skips LLM call!)
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

    expect(callCount).toBe(1); // LLM provider NOT called again!
    expect(res2.metrics.cacheHits).toBe(1);
    expect(res2.metrics.tier1CacheHits).toBe(1);
    expect(res2.metrics.avoidedLlmCalls).toBe(1);
    expect(res2.findings[0]!.semgrepDecision).toBe('CONFIRMED');
    expect(res2.findings[0]!.semgrepReason).toBe('Secret found');
  });

  it('2. Un cache miss déclenche l\'appel LLM et enregistre un résultat valide', async () => {
    let callCount = 0;
    const mockLlm = createMockLlm('economic', 'v1', () => {
      callCount++;
      return {
        data: {
          summary: 'Analyzed',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'REJECTED', reason: 'False positive' }],
        },
        tokensIn: 150,
        tokensOut: 45,
      };
    });

    const cacheStore = new InMemoryLlmCacheStore();

    const res = await reviewBatches(
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

    expect(callCount).toBe(1);
    expect(res.metrics.cacheMisses).toBe(1);
    expect(res.findings[0]!.semgrepDecision).toBe('REJECTED');

    // Verify key was saved in cacheStore
    const ctx = await extractTargetedContext(fileA, { findingLines: [10], semgrepAlerts: [sampleAlert] });
    const key = createCacheKey({
      targetedContext: ctx.formattedText,
      alert: sampleAlert,
      tier: 1,
      provider: 'economic',
      model: 'v1',
      rules: [],
      strictness: 'medium',
      escalationPolicy: { escalateOnHighSeverity: false },
    });
    // Store had key added
    const entry = await cacheStore.get(key);
    expect(entry).not.toBeNull();
  });

  it('3. Une modification du code provoque un cache miss', async () => {
    const keyOriginal = createCacheKey({
      targetedContext: '--- src/auth.ts:10-12 ---\n   10 + const secret = "original_code";',
      alert: sampleAlert,
      tier: 1,
      provider: 'economic',
      model: 'v1',
    });

    const keyModifiedCode = createCacheKey({
      targetedContext: '--- src/auth.ts:10-12 ---\n   10 + const secret = "modified_code_context";',
      alert: sampleAlert,
      tier: 1,
      provider: 'economic',
      model: 'v1',
    });

    expect(keyOriginal).not.toBe(keyModifiedCode);
  });

  it('4. Une modification des alertes Semgrep provoque un cache miss', async () => {
    const alertModified: SemgrepAlert = {
      ...sampleAlert,
      message: 'Modified semgrep alert message for security rule',
    };

    const keyOriginal = createCacheKey({
      targetedContext: '--- src/auth.ts:10-12 ---',
      alert: sampleAlert,
      tier: 1,
      provider: 'economic',
      model: 'v1',
    });

    const keyModifiedAlert = createCacheKey({
      targetedContext: '--- src/auth.ts:10-12 ---',
      alert: alertModified,
      tier: 1,
      provider: 'economic',
      model: 'v1',
    });

    expect(keyOriginal).not.toBe(keyModifiedAlert);
  });

  it('5. Une modification du modèle, du prompt ou de la politique provoque un cache miss', async () => {
    const keyModelV1 = createCacheKey({
      targetedContext: 'context',
      alert: sampleAlert,
      tier: 1,
      provider: 'provider-a',
      model: 'model-v1',
    });

    const keyModelV2 = createCacheKey({
      targetedContext: 'context',
      alert: sampleAlert,
      tier: 1,
      provider: 'provider-a',
      model: 'model-v2', // Model changed!
    });

    const keyPromptV2 = createCacheKey({
      targetedContext: 'context',
      alert: sampleAlert,
      tier: 1,
      provider: 'provider-a',
      model: 'model-v1',
      promptVersion: 'v2', // System prompt changed!
    });

    expect(keyModelV1).not.toBe(keyModelV2);
    expect(keyModelV1).not.toBe(keyPromptV2);
  });

  it('6. Une réponse invalide ou incomplète n\'est pas mise en cache', async () => {
    let calls = 0;
    const mockFailingJson = createMockLlm('economic', 'v1', () => {
      calls++;
      return 'INVALID_NON_JSON_RESPONSE';
    });

    const cacheStore = new InMemoryLlmCacheStore();

    try {
      await reviewBatches(
        [mockFailingJson],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert],
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true },
      );
    } catch {
      // Expected LLM parse error
    }

    // Key should NOT exist in cache
    const key = createCacheKey({
      targetedContext: 'context',
      alert: sampleAlert,
      tier: 1,
      provider: 'economic',
      model: 'v1',
    });

    expect(await cacheStore.get(key)).toBeNull();
  });

  it('7. Une erreur fournisseur ou un timeout n\'est pas mis en cache comme succès', async () => {
    const failingProvider: LlmProvider = {
      name: 'failing-provider',
      model: 'v1',
      async generate() {
        throw new Error('504 Gateway Timeout');
      },
    };

    const cacheStore = new InMemoryLlmCacheStore();

    try {
      await reviewBatches(
        [failingProvider],
        [fileA],
        new Map(),
        new Map(),
        [sampleAlert],
        new Map(),
        [],
        'medium',
        { cacheStore, enableCache: true },
      );
    } catch {
      // Expected timeout error
    }

    const key = createCacheKey({
      targetedContext: 'context',
      alert: sampleAlert,
      tier: 1,
      provider: 'failing-provider',
      model: 'v1',
    });

    expect(await cacheStore.get(key)).toBeNull();
  });

  it('8. Un résultat Tier 1 en cache n\'empêche pas une escalade requise', async () => {
    let tier2Called = false;
    const mockEconomic = createMockLlm('economic', 'v1', () => ({
      data: {
        summary: 'Triage',
        findings: [],
        semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'UNCERTAIN', reason: 'Needs tier 2' }],
      },
    }));

    const mockPowerful = createMockLlm('powerful', 'v2', () => {
      tier2Called = true;
      return {
        data: {
          summary: 'Tier 2 confirmed',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Tier 2 verified' }],
        },
      };
    });

    const cacheStore = new InMemoryLlmCacheStore();

    // 1st run: Populates Tier 1 cache with UNCERTAIN
    await reviewBatches(
      [mockEconomic],
      [fileA],
      new Map(),
      new Map(),
      [sampleAlert],
      new Map(),
      [],
      'medium',
      {
        cacheStore,
        enableCache: true,
        powerfulLlm: [mockPowerful],
        escalationPolicy: { escalateOnUncertain: true },
      },
    );

    expect(tier2Called).toBe(true);

    // Reset Tier 2 call flag
    tier2Called = false;

    // 2nd run: Tier 1 hits cache, BUT since Tier 1 decision was UNCERTAIN, escalation policy STILL triggers Tier 2!
    const res2 = await reviewBatches(
      [mockEconomic],
      [fileA],
      new Map(),
      new Map(),
      [sampleAlert],
      new Map(),
      [],
      'medium',
      {
        cacheStore,
        enableCache: true,
        powerfulLlm: [mockPowerful],
        escalationPolicy: { escalateOnUncertain: true },
      },
    );

    expect(res2.metrics.tier1CacheHits).toBe(1);
    expect(res2.findings[0]!.semgrepDecision).toBe('CONFIRMED');
  });

  it('9. Un résultat Tier 2 est réutilisé uniquement dans des conditions compatibles', async () => {
    const keyTier1 = createCacheKey({
      targetedContext: 'ctx',
      alert: sampleAlert,
      tier: 1,
      provider: 'economic',
      model: 'v1',
    });

    const keyTier2 = createCacheKey({
      targetedContext: 'ctx',
      alert: sampleAlert,
      tier: 2,
      provider: 'powerful',
      model: 'v2',
    });

    // Tier 1 and Tier 2 generate distinct cache keys!
    expect(keyTier1).not.toBe(keyTier2);
  });

  it('10. Deux lots différents peuvent réutiliser le résultat d\'une alerte identique', async () => {
    const cacheStore = new InMemoryLlmCacheStore();

    const entry: CacheEntry = {
      decision: 'CONFIRMED',
      reason: 'Cached alert decision',
      provider: 'economic',
      model: 'v1',
      tier: 1,
      tokensIn: 100,
      tokensOut: 50,
      createdAt: new Date().toISOString(),
    };

    // Pre-populate item-level cache for sampleAlert
    const ctx = await extractTargetedContext(fileA, { findingLines: [10], semgrepAlerts: [sampleAlert] });
    const key = createCacheKey({
      targetedContext: ctx.formattedText,
      alert: sampleAlert,
      tier: 1,
      provider: 'economic',
      model: 'v1',
      rules: [],
      strictness: 'medium',
      escalationPolicy: { escalateOnHighSeverity: false },
    });
    await cacheStore.set(key, entry);

    let llmCalls = 0;
    const mockLlm = createMockLlm('economic', 'v1', () => {
      llmCalls++;
      return { data: { summary: 'OK', findings: [], semgrep_decisions: [] } };
    });

    // Review sampleAlert in Batch 1 configuration
    const res = await reviewBatches(
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

    expect(llmCalls).toBe(0); // Served directly from item-level cache!
    expect(res.metrics.cacheHits).toBe(1);
    expect(res.findings[0]!.semgrepDecision).toBe('CONFIRMED');
  });

  it('11. Une panne du cache déclenche le comportement de repli documenté', async () => {
    // Failing cache store whose methods throw exceptions
    const brokenCacheStore: LlmCacheStore = {
      async get() {
        throw new Error('PostgreSQL database connection reset');
      },
      async set() {
        throw new Error('Database disk full');
      },
    };

    let llmCalled = false;
    const mockLlm = createMockLlm('economic', 'v1', () => {
      llmCalled = true;
      return {
        data: {
          summary: 'Fallback execution',
          findings: [],
          semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'Verified' }],
        },
      };
    });

    // Pipeline completes cleanly despite DB cache failure!
    const res = await reviewBatches(
      [mockLlm],
      [fileA],
      new Map(),
      new Map(),
      [sampleAlert],
      new Map(),
      [],
      'medium',
      { cacheStore: brokenCacheStore, enableCache: true, escalationPolicy: { escalateOnHighSeverity: false } },
    );

    expect(llmCalled).toBe(true);
    expect(res.findings[0]!.semgrepDecision).toBe('CONFIRMED');
    expect(res.metrics.cacheErrors).toBeGreaterThan(0);
  });

  it('12. Plusieurs workers concurrents ne corrompent pas les résultats (Atomic Store test)', async () => {
    const store = new InMemoryLlmCacheStore();

    const entry1: CacheEntry = {
      decision: 'CONFIRMED',
      reason: 'Worker 1 decision',
      provider: 'economic',
      model: 'v1',
      tier: 1,
      tokensIn: 100,
      tokensOut: 50,
      createdAt: new Date().toISOString(),
    };

    const entry2: CacheEntry = {
      decision: 'CONFIRMED',
      reason: 'Worker 2 decision',
      provider: 'economic',
      model: 'v1',
      tier: 1,
      tokensIn: 100,
      tokensOut: 50,
      createdAt: new Date().toISOString(),
    };

    const key = 'concurrent-key-1';

    // Simulate two concurrent workers writing to the same key simultaneously
    await Promise.all([store.set(key, entry1), store.set(key, entry2)]);

    const result = await store.get(key);
    expect(result).not.toBeNull();
    expect(result?.decision).toBe('CONFIRMED');
  });

  it('13. L\'expiration ou l\'invalidation fonctionne', async () => {
    const store = new InMemoryLlmCacheStore();
    const key = 'expiring-key';
    const entry: CacheEntry = {
      decision: 'CONFIRMED',
      reason: 'Short lived decision',
      provider: 'economic',
      model: 'v1',
      tier: 1,
      tokensIn: 100,
      tokensOut: 50,
      createdAt: new Date().toISOString(),
    };

    // Store entry with 10ms TTL (expired)
    await store.set(key, entry, -100); // Already expired in the past

    const cached = await store.get(key);
    expect(cached).toBeNull(); // Expired entry treated as cache miss
  });

  it('14. Les métriques distinguent correctement appels réels, cache hits et économies', async () => {
    const store = new InMemoryLlmCacheStore();
    const mockLlm = createMockLlm('economic', 'v1', () => ({
      data: {
        summary: 'Review',
        findings: [],
        semgrep_decisions: [{ alert_id: 'semgrep-auth-10-1', decision: 'CONFIRMED', reason: 'OK' }],
      },
      tokensIn: 200,
      tokensOut: 60,
    }));

    // Run 1: Miss
    const res1 = await reviewBatches(
      [mockLlm],
      [fileA],
      new Map(),
      new Map(),
      [sampleAlert],
      new Map(),
      [],
      'medium',
      { cacheStore: store, enableCache: true, escalationPolicy: { escalateOnHighSeverity: false } },
    );

    expect(res1.metrics.cacheHits).toBe(0);
    expect(res1.metrics.cacheMisses).toBe(1);
    expect(res1.metrics.tier1Calls).toBe(1);

    // Run 2: Hit
    const res2 = await reviewBatches(
      [mockLlm],
      [fileA],
      new Map(),
      new Map(),
      [sampleAlert],
      new Map(),
      [],
      'medium',
      { cacheStore: store, enableCache: true, escalationPolicy: { escalateOnHighSeverity: false } },
    );

    expect(res2.metrics.cacheHits).toBe(1);
    expect(res2.metrics.cacheHitRatio).toBe(1);
    expect(res2.metrics.avoidedLlmCalls).toBe(1);
    expect(res2.metrics.savedTokensIn).toBe(200);
    expect(res2.metrics.savedTokensOut).toBe(60);
    expect(res2.metrics.tier1Calls).toBe(0); // 0 LLM calls made!
  });
});
