import { describe, expect, it } from 'vitest';
import { LlmReviewOutputSchema } from '@codereview/shared';
import { generateJson, LlmError } from '@codereview/llm';
import type { LlmProvider } from '@codereview/llm';
import { calculateCallCostUsd, getPricingConfig } from './pricing.js';
import { aggregateQualityMetrics, calculateF1, ratio } from './scoring.js';
import type { EvalSpec, ScoredFinding } from './scoring.js';
import { BenchmarkRunner, CircuitBreakerGuard, CircuitBreakerExceededError, createGuardedProvider } from './benchmark-runner.js';
import type { BenchmarkCase, MockLlmCallRecord, VariantKey } from './benchmark-runner.js';
import { generateBenchmarkReport } from './report-generator.js';
import { loadBenchmarkCases, runFullBenchmark } from './run-benchmark.js';

describe('Étape 6 — Benchmark Evaluation, Pricing & Quality Metrics', () => {
  describe('Pricing Configuration & Cost Calculation (pricing.ts)', () => {
    it('returns valid pricing config for known standard models', () => {
      const gpt4oMini = getPricingConfig('openai-api', 'gpt-4o-mini');
      expect(gpt4oMini).not.toBeNull();
      expect(gpt4oMini?.inputUsdPer1M).toBe(0.15);
      expect(gpt4oMini?.outputUsdPer1M).toBe(0.60);
      expect(gpt4oMini?.currency).toBe('USD');

      const sonnet = getPricingConfig('anthropic', 'claude-3-5-sonnet-20241022');
      expect(sonnet).not.toBeNull();
      expect(sonnet?.inputUsdPer1M).toBe(3.00);
      expect(sonnet?.outputUsdPer1M).toBe(15.00);

      const geminiFlash = getPricingConfig('gemini', 'gemini-1.5-flash');
      expect(geminiFlash).not.toBeNull();
      expect(geminiFlash?.inputUsdPer1M).toBe(0.075);
    });

    it('calculates correct cost for configured model calls', () => {
      // 1,000,000 in ($0.15) + 500,000 out ($0.30) = $0.45
      const res = calculateCallCostUsd('openai-api', 'gpt-4o-mini', 1_000_000, 500_000);
      expect(res.isConfigured).toBe(true);
      expect(res.costUsd).toBe(0.45);
    });

    it('returns null cost for unknown/unconfigured models to avoid underreporting', () => {
      const res = calculateCallCostUsd('unknown-provider', 'unknown-model-xyz', 100_000, 50_000);
      expect(res.isConfigured).toBe(false);
      expect(res.costUsd).toBeNull();
    });
  });

  describe('Quality & Precision/Recall Metrics (scoring.ts)', () => {
    it('calculates ratio and F1 score accurately', () => {
      expect(ratio(4, 5)).toBe(0.8);
      expect(ratio(0, 0)).toBeNull();

      const f1 = calculateF1(0.8, 0.6);
      // 2 * (0.8 * 0.6) / (0.8 + 0.6) = 0.96 / 1.4 = ~0.6857
      expect(f1).toBe(0.6857);

      expect(calculateF1(null, 0.8)).toBeNull();
      expect(calculateF1(0, 0)).toBeNull();
    });

    it('aggregates precision, recall, F1, FP, FN, and critical/high breakdown', () => {
      const spec1: EvalSpec = {
        expected: [
          { file: 'src/a.ts', lines: [10, 15], severity: 'critical', category: 'security', issue: 'XSS' },
          { file: 'src/b.ts', lines: [20, 25], severity: 'high', category: 'security', issue: 'SQLi' },
        ],
      };

      const found1: ScoredFinding[] = [
        { filePath: 'src/a.ts', lineStart: 11, lineEnd: 12, severity: 'critical' },
        { filePath: 'src/c.ts', lineStart: 5, lineEnd: 10, severity: 'low' }, // False positive
      ];

      const metrics = aggregateQualityMetrics([{ spec: spec1, found: found1 }]);

      expect(metrics.totalExpected).toBe(2);
      expect(metrics.totalCaught).toBe(1); // Caught XSS, missed SQLi
      expect(metrics.totalFindings).toBe(2);
      expect(metrics.totalOnTarget).toBe(1);
      expect(metrics.falsePositives).toBe(1);
      expect(metrics.falseNegatives).toBe(1);

      expect(metrics.recall).toBe(0.5); // 1 / 2
      expect(metrics.precision).toBe(0.5); // 1 / 2
      expect(metrics.f1Score).toBe(0.5);

      expect(metrics.criticalHighExpected).toBe(2);
      expect(metrics.criticalHighCaught).toBe(1);
      expect(metrics.criticalHighRecall).toBe(0.5);

      expect(metrics.severityBreakdown.critical.caught).toBe(1);
      expect(metrics.severityBreakdown.high.caught).toBe(0);
    });
  });

  describe('Comparative Benchmark Runner & Report Generator', () => {
    it('executes runner and distinguishes real tokens from counterfactual saved tokens', async () => {
      const runner = new BenchmarkRunner();
      const testCases: BenchmarkCase[] = [
        {
          id: 'test-c1',
          name: 'test-case-1',
          diff: 'diff text',
          spec: {
            expected: [
              { file: 'app.ts', lines: [5, 10], severity: 'critical', issue: 'Bug' },
            ],
          },
        },
      ];

      const res = await runner.runVariant('optimized_pipeline', testCases, async () => ({
        findings: [{ filePath: 'app.ts', lineStart: 6, lineEnd: 8, severity: 'critical' }],
        llmCalls: [
          {
            provider: 'mock',
            model: 'mock-economic',
            tier: 'tier1',
            tokensIn: 500,
            tokensOut: 100,
          },
          {
            provider: 'mock',
            model: 'mock-economic',
            tier: 'tier1',
            tokensIn: 500,
            tokensOut: 100,
            isCacheHit: true,
          },
        ],
        durationMs: 150,
      }));

      expect(res.totalLlmCalls).toBe(1); // 1 real call + 1 cache hit
      expect(res.cacheHits).toBe(1);
      expect(res.realTokensIn).toBe(500);
      expect(res.savedTokensIn).toBe(500); // from cache hit
      expect(res.quality.recall).toBe(1.0);
    });

    it('generates a full markdown report matching all requirements', async () => {
      const benchmarkData = await runFullBenchmark();
      const reportMarkdown = generateBenchmarkReport(benchmarkData);

      expect(reportMarkdown).toContain('# Comparative Evaluation Report: Cost, Latency & Quality (Étape 6)');
      expect(reportMarkdown).toContain('## 1. Environment & Model Configuration');
      expect(reportMarkdown).toContain('## 2. Configured Model Pricing Table');
      expect(reportMarkdown).toContain('## 3. Benchmark Dataset Summary');
      expect(reportMarkdown).toContain('## 4. Main Comparative Results Table');
      expect(reportMarkdown).toContain('## 5. Quality Breakdown by Vulnerability Severity');
      expect(reportMarkdown).toContain('## 6. Operational Resilience & Fault Tolerance Matrix');
      expect(reportMarkdown).toContain('## 7. Mock vs. Live Evaluation Methodology & Separation');
      expect(reportMarkdown).toContain('## 8. Methodological Limitations & Verification Rules');
      expect(reportMarkdown).toContain('Baseline');
      expect(reportMarkdown).toContain('Optimized (Cold)');
      expect(reportMarkdown).toContain('Optimized (Warm)');
      expect(reportMarkdown).toContain('Degraded: No Semgrep');
      expect(reportMarkdown).toContain('Degraded: No PostgreSQL');
      expect(reportMarkdown).toContain('### 7.2 Staging Validation Protocol with Live Providers');
      expect(reportMarkdown).toContain('### 7.3 Go / No-Go Acceptance & Rejection Criteria');
      expect(reportMarkdown).toContain('Monthly Spend Limit = $5.00');
    });

    it('loads synthetic default cases cleanly when evals directory is empty or missing', () => {
      const cases = loadBenchmarkCases();
      expect(cases.length).toBeGreaterThan(0);
      expect(cases[0].spec.expected.length).toBeGreaterThan(0);
    });

    it('guarantees deterministic benchmark reproducibility across consecutive executions', async () => {
      const run1 = await runFullBenchmark();
      const run2 = await runFullBenchmark();

      // Ensure identical metrics across runs
      expect(run1.results.baseline.realTokensIn).toBe(run2.results.baseline.realTokensIn);
      expect(run1.results.baseline.realTokensOut).toBe(run2.results.baseline.realTokensOut);
      expect(run1.results.baseline.realCostUsd).toBe(run2.results.baseline.realCostUsd);

      expect(run1.results.optimized_pipeline.realTokensIn).toBe(run2.results.optimized_pipeline.realTokensIn);
      expect(run1.results.optimized_pipeline.realCostUsd).toBe(run2.results.optimized_pipeline.realCostUsd);
      expect(run1.results.optimized_pipeline.quality.f1Score).toBe(run2.results.optimized_pipeline.quality.f1Score);

      expect(run1.results.optimized_warm_cache.realTokensIn).toBe(run2.results.optimized_warm_cache.realTokensIn);
      expect(run1.results.optimized_warm_cache.cacheHitRate).toBe(1.0);
      expect(run2.results.optimized_warm_cache.cacheHitRate).toBe(1.0);
    });

    it('verifies non-artificial quality scoring and realistic differential between baseline and optimized', async () => {
      const benchmarkData = await runFullBenchmark();
      const baseline = benchmarkData.results.baseline;
      const optimized = benchmarkData.results.optimized_pipeline;

      // Baseline should demonstrate realistic failure modes (FP on clean diff, FN on unassisted complex diff)
      expect(baseline.quality.falsePositives).toBeGreaterThan(0);
      expect(baseline.quality.falseNegatives).toBeGreaterThan(0);
      expect(baseline.quality.f1Score).toBeLessThan(1.0);

      // Optimized pipeline eliminates FP and catches ground-truth vulnerabilities via AST targeting + Semgrep
      expect(optimized.quality.falsePositives).toBe(0);
      expect(optimized.quality.falseNegatives).toBe(0);
      expect(optimized.quality.f1Score).toBe(1.0);
      expect(optimized.quality.f1Score!).toBeGreaterThan(baseline.quality.f1Score!);

      // Avoided tokens is accurately calculated without cross-case running total overflow
      expect(benchmarkData.results.targeted_context.savedTokensIn).toBeGreaterThan(0);
      expect(optimized.savedTokensIn).toBeGreaterThan(0);
    });

    it('verifies two-tier escalation routing logic (Tier 1 triage to Tier 2 deep analysis)', async () => {
      const benchmarkData = await runFullBenchmark();
      const twoTier = benchmarkData.results.two_tier_routing;

      // Dataset contains 7 cases, where cases with critical/high severities escalate to Tier 2
      expect(twoTier.tier1Calls).toBe(benchmarkData.datasetSummary.totalCases);
      expect(twoTier.tier2Calls).toBeGreaterThan(0);
      expect(twoTier.tier2Calls).toBeLessThanOrEqual(twoTier.tier1Calls);
      // Escalation rate = tier2Calls / tier1Calls
      expect(twoTier.tier2EscalationRate).toBe(Number((twoTier.tier2Calls / twoTier.tier1Calls).toFixed(4)));
    });

    it('validates operational resilience under degraded operating conditions', async () => {
      const benchmarkData = await runFullBenchmark();

      // Degraded: No Semgrep
      const noSemgrep = benchmarkData.results.degraded_no_semgrep;
      expect(noSemgrep).toBeDefined();
      expect(noSemgrep.totalLlmCalls).toBeGreaterThan(0);
      expect(noSemgrep.quality.recall).toBeGreaterThan(0);

      // Degraded: No DB (PostgreSQL disconnected)
      const noDb = benchmarkData.results.degraded_no_db;
      expect(noDb).toBeDefined();
      expect(noDb.totalLlmCalls).toBeGreaterThan(0);
      expect(noDb.cacheHits).toBe(0); // Cannot hit DB cache
      expect(noDb.quality.recall).toBeGreaterThan(0);

      // Warm Cache: 100% hits, 0 real LLM calls, $0.00 cost
      const warm = benchmarkData.results.optimized_warm_cache;
      expect(warm).toBeDefined();
      expect(warm.cacheHitRate).toBe(1.0);
      expect(warm.cacheHits).toBe(benchmarkData.datasetSummary.totalCases);
      expect(warm.totalLlmCalls).toBe(0);
      expect(warm.realCostUsd).toBe(0);
      expect(warm.savedTokensIn).toBeGreaterThan(0);
    });

    it('enforces application-level circuit breakers on maxRequests, maxTokens, maxCostUsd and abortSignal', async () => {
      const runner = new BenchmarkRunner();
      const testCases: BenchmarkCase[] = [
        {
          id: 'case-a',
          name: 'case-a',
          diff: 'diff-a',
          spec: { expected: [] },
        },
        {
          id: 'case-b',
          name: 'case-b',
          diff: 'diff-b',
          spec: { expected: [] },
        },
        {
          id: 'case-c',
          name: 'case-c',
          diff: 'diff-c',
          spec: { expected: [] },
        },
      ];

      // 1. Request limit circuit breaker
      const requestRunner = new BenchmarkRunner({ limits: { maxRequests: 2 } });
      await expect(
        requestRunner.runVariant('baseline', testCases, async () => ({
          findings: [],
          llmCalls: [{ provider: 'mock', model: 'mock-economic', tier: 'tier1', tokensIn: 100, tokensOut: 50 }],
          durationMs: 10,
        }))
      ).rejects.toThrow('Circuit breaker tripped: request ceiling of 2 reached');

      // 2. Token limit circuit breaker
      const tokenRunner = new BenchmarkRunner({ limits: { maxTokens: 250 } });
      await expect(
        tokenRunner.runVariant('baseline', testCases, async () => ({
          findings: [],
          llmCalls: [{ provider: 'mock', model: 'mock-economic', tier: 'tier1', tokensIn: 200, tokensOut: 100 }],
          durationMs: 10,
        }))
      ).rejects.toThrow('Circuit breaker tripped: token ceiling of 250');

      // 3. Cost limit circuit breaker
      const costRunner = new BenchmarkRunner({ limits: { maxCostUsd: 0.0001 } });
      await expect(
        costRunner.runVariant('baseline', testCases, async () => ({
          findings: [],
          llmCalls: [{ provider: 'mock', model: 'mock-powerful', tier: 'tier2', tokensIn: 50000, tokensOut: 10000 }],
          durationMs: 10,
        }))
      ).rejects.toThrow('Circuit breaker tripped: cost budget ceiling');

      // 4. Operator abort signal kill switch
      const controller = new AbortController();
      controller.abort();
      const abortRunner = new BenchmarkRunner({ limits: { abortSignal: controller.signal } });
      await expect(
        abortRunner.runVariant('baseline', testCases, async () => ({
          findings: [],
          llmCalls: [{ provider: 'mock', model: 'mock-economic', tier: 'tier1', tokensIn: 10, tokensOut: 10 }],
          durationMs: 10,
        }))
      ).rejects.toThrow('Emergency stop triggered: operator abort signal active');
    });

    it('proves mathematical reconciliation: per-case saved tokens, escalation rate denominator, and warm cache isolation', async () => {
      const benchmarkData = await runFullBenchmark();
      const targeted = benchmarkData.results.targeted_context;
      const twoTier = benchmarkData.results.two_tier_routing;
      const warm = benchmarkData.results.optimized_warm_cache;
      const baseline = benchmarkData.results.baseline;

      // 1. Escalation rate denominator must be Tier 1 triage calls, NOT (Tier 1 + Tier 2)
      // Two-tier ran 7 Tier-1 calls, 5 escalated to Tier-2 => 5 / 7 = 0.7143 (71.4%)
      expect(twoTier.tier1Calls).toBe(7);
      expect(twoTier.tier2Calls).toBe(5);
      expect(twoTier.tier2EscalationRate).toBe(0.7143);
      // Ensure it is NOT the faulty 5 / 12 = 0.4167
      expect(twoTier.tier2EscalationRate).not.toBe(0.4167);

      // 2. Targeted context avoided tokens must be exact delta: Baseline In (82,248) - Targeted In (28,787) = 53,461 in
      const expectedDeltaIn = baseline.realTokensIn - targeted.realTokensIn;
      expect(targeted.savedTokensIn).toBe(expectedDeltaIn);

      // 3. Warm cache avoided tokens must equal the bypassed calls without double counting baseline
      expect(warm.realTokensIn).toBe(0);
      expect(warm.realTokensOut).toBe(0);
      expect(warm.realCostUsd).toBe(0);
      // Saved tokens in warm cache must be less than baseline total tokens (no double counting)
      expect(warm.savedTokensIn + warm.savedTokensOut).toBeLessThan(baseline.realTokensIn + baseline.realTokensOut);
    });

    it('verifies exact quality metrics calculation from TP, FP, FN and mathematical invariants', async () => {
      const benchmarkData = await runFullBenchmark();
      const baseline = benchmarkData.results.baseline;
      const optimized = benchmarkData.results.optimized_pipeline;

      // Baseline exact metrics: 10 TP, 2 FP, 1 FN, 11 Expected, 12 Total Findings
      expect(baseline.quality.totalExpected).toBe(11);
      expect(baseline.quality.totalCaught).toBe(10);
      expect(baseline.quality.totalOnTarget).toBe(10);
      expect(baseline.quality.totalFindings).toBe(12);
      expect(baseline.quality.falsePositives).toBe(2);
      expect(baseline.quality.falseNegatives).toBe(1);

      // Invariants:
      // totalFindings = totalOnTarget + falsePositives (12 = 10 + 2)
      expect(baseline.quality.totalFindings).toBe(baseline.quality.totalOnTarget + baseline.quality.falsePositives);
      // totalExpected = totalCaught + falseNegatives (11 = 10 + 1)
      expect(baseline.quality.totalExpected).toBe(baseline.quality.totalCaught + baseline.quality.falseNegatives);

      // Precision = 10 / 12 = 0.8333 (83.3%)
      expect(baseline.quality.precision).toBe(0.8333);
      // Recall = 10 / 11 = 0.9091 (90.9%)
      expect(baseline.quality.recall).toBe(0.9091);
      // F1 = 2 * (10/12 * 10/11) / (10/12 + 10/11) = 20 / 23 = 0.8696 (87.0% / ~86.0%)
      expect(baseline.quality.f1Score).toBe(0.8696);

      // Optimized exact metrics: 11 TP, 0 FP, 0 FN, 11 Expected, 11 Total Findings
      expect(optimized.quality.totalExpected).toBe(11);
      expect(optimized.quality.totalCaught).toBe(11);
      expect(optimized.quality.totalOnTarget).toBe(11);
      expect(optimized.quality.totalFindings).toBe(11);
      expect(optimized.quality.falsePositives).toBe(0);
      expect(optimized.quality.falseNegatives).toBe(0);
      expect(optimized.quality.precision).toBe(1.0);
      expect(optimized.quality.recall).toBe(1.0);
      expect(optimized.quality.f1Score).toBe(1.0);

      // Verify separated simulated latency and wall-clock runtime
      expect(baseline.durationMs).toBe(8400); // 7 cases * 1200ms
      expect(baseline.wallClockDurationMs).toBeGreaterThanOrEqual(0);
      expect(optimized.durationMs).toBe(1540); // 7 cases * 220ms
      expect(optimized.wallClockDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('formats baseline F1 as exact 86.96% (20/23) in generated report', async () => {
      const benchmarkData = await runFullBenchmark();
      const reportMarkdown = generateBenchmarkReport(benchmarkData);
      expect(reportMarkdown).toContain('Baseline F1 = 86.96% (20/23)');
    });

    it('CircuitBreakerGuard: atomically reserves budget without race conditions during concurrent calls', async () => {
      const guard = new CircuitBreakerGuard({ maxRequests: 2 });
      let callCount = 0;
      let rejectCount = 0;

      // Launch 3 concurrent calls simultaneously in the same microtask
      const tasks = [1, 2, 3].map(async () => {
        try {
          const allocation = guard.reserveCall({
            provider: 'mock',
            model: 'mock-economic',
            estimatedTokensIn: 50,
          });
          callCount++;
          await new Promise((r) => setTimeout(r, 10));
          allocation.release({ tokensIn: 50, tokensOut: 50 });
        } catch (err) {
          if (err instanceof CircuitBreakerExceededError) {
            rejectCount++;
          } else {
            throw err;
          }
        }
      });

      await Promise.all(tasks);

      // Exactly 2 calls were allowed and 1 was synchronously rejected before running
      expect(callCount).toBe(2);
      expect(rejectCount).toBe(1);
      expect(guard.getStats().currentRequests).toBe(2);
    });

    it('CircuitBreakerGuard: calculates pre-call estimation with maximum possible output tokens and cost', () => {
      // Powerful model: $3.00/1M in, $15.00/1M out.
      // 10,000 in ($0.030) + 4096 out default ($0.06144) = $0.09144 max possible cost.
      // Setting ceiling at $0.05 must trip BEFORE any call is dispatched.
      const guard = new CircuitBreakerGuard({ maxCostUsd: 0.05 });

      expect(() => {
        guard.reserveCall({
          provider: 'mock',
          model: 'mock-powerful',
          estimatedTokensIn: 10000,
        });
      }).toThrow('cost budget ceiling of $0.05 reached');
    });

    it('CircuitBreakerGuard: prevents Tier 2 escalation when budget ceiling is exceeded', () => {
      // Ceiling of $0.05 allows cheap Tier 1 call ($0.15/1M in, $0.60/1M out -> ~$0.0007),
      // but blocks expensive Tier 2 escalation on mock-powerful ($0.09144).
      const guard = new CircuitBreakerGuard({ maxCostUsd: 0.05 });

      // Step 1: Tier 1 Triage Call
      const t1Alloc = guard.reserveCall({
        provider: 'mock',
        model: 'mock-economic',
        estimatedTokensIn: 500,
        tier: 'tier1',
      });
      t1Alloc.release({ tokensIn: 500, tokensOut: 100, costUsd: 0.000135 });
      expect(guard.getStats().currentRequests).toBe(1);

      // Step 2: Tier 2 Escalation Call fails pre-call reservation
      expect(() => {
        guard.reserveCall({
          provider: 'mock',
          model: 'mock-powerful',
          estimatedTokensIn: 10000,
          tier: 'tier2',
        });
      }).toThrow('cost budget ceiling of $0.05 reached');
    });

    it('CircuitBreakerGuard: blocks retries when request ceiling is exhausted', () => {
      // Max requests = 1: initial call permitted, but retry must be blocked
      const guard = new CircuitBreakerGuard({ maxRequests: 1 });

      const attempt1 = guard.reserveCall({
        provider: 'mock',
        model: 'mock-economic',
        estimatedTokensIn: 100,
      });
      // Attempt 1 fails (e.g. invalid json), but consumed a request
      attempt1.release({ tokensIn: 100, tokensOut: 20 });
      expect(guard.getStats().currentRequests).toBe(1);

      // Attempt 2 (retry) is blocked
      expect(() => {
        guard.reserveCall({
          provider: 'mock',
          model: 'mock-economic',
          estimatedTokensIn: 100,
        });
      }).toThrow('request ceiling of 1 reached');
    });

    it('Transport & generateJson: aborts HTTP in-flight request and does not retry on abort signal', async () => {
      const controller = new AbortController();

      const mockProvider: LlmProvider = {
        name: 'mock-abort',
        model: 'mock-abort-model',
        async generate(input) {
          if (input.signal?.aborted) {
            throw new LlmError('mock-abort: request aborted', undefined, false);
          }
          // Abort during execution
          controller.abort();
          if (input.signal?.aborted) {
            throw new LlmError('mock-abort: request aborted', undefined, false);
          }
          return { text: '{}', tokensIn: 10, tokensOut: 10 };
        },
      };

      await expect(
        generateJson([mockProvider], {
          system: 'sys',
          prompt: 'prompt',
          schema: LlmReviewOutputSchema,
          signal: controller.signal,
          backoffMs: 100,
        })
      ).rejects.toThrow('request aborted');
    });

    it('createGuardedProvider: intercepts retries and increments request count, blocking when maxRequests is reached', async () => {
      const guard = new CircuitBreakerGuard({ maxRequests: 2 });
      let generateCalls = 0;

      const flakyProvider: LlmProvider = {
        name: 'mock',
        model: 'mock-economic',
        async generate() {
          generateCalls++;
          // Return invalid json to trigger retry inside generateJson
          return { text: 'not valid json', tokensIn: 50, tokensOut: 10 };
        },
      };

      const guarded = createGuardedProvider(flakyProvider, guard);

      // Attempt 1 fails parsing -> retry attempt 2 fails parsing -> exceeds maxRequests (2)
      await expect(
        generateJson([guarded], {
          system: 'sys',
          prompt: 'prompt',
          schema: LlmReviewOutputSchema,
          backoffMs: 10,
        })
      ).rejects.toThrow();

      // Exactly 2 attempts were made before being stopped
      expect(generateCalls).toBe(2);
      expect(guard.getStats().currentRequests).toBe(2);

      // Next attempt immediately trips circuit breaker
      await expect(
        generateJson([guarded], {
          system: 'sys',
          prompt: 'prompt',
          schema: LlmReviewOutputSchema,
        })
      ).rejects.toThrow('request ceiling of 2 reached');
    });

    it('createGuardedProvider: enforces token ceiling pre-call before any HTTP dispatch', async () => {
      const guard = new CircuitBreakerGuard({ maxTokens: 1000 });
      let dispatched = false;

      const provider: LlmProvider = {
        name: 'mock',
        model: 'mock-economic',
        async generate() {
          dispatched = true;
          return { text: '{"summary":"ok","findings":[]}', tokensIn: 500, tokensOut: 50 };
        },
      };

      const guarded = createGuardedProvider(provider, guard);

      // Prompt of ~4000 characters is ~1000 tokens in + 1500 max output = 2500 tokens > 1000 token ceiling
      const largePrompt = 'a'.repeat(4000);

      await expect(
        guarded.generate({
          system: 'sys',
          prompt: largePrompt,
          json: true,
          maxOutputTokens: 1500,
        })
      ).rejects.toThrow('token ceiling of 1000 reached');

      expect(dispatched).toBe(false);
    });

    it('createGuardedProvider: tracks Tier 2 escalation calls towards maxRequests', async () => {
      const guard = new CircuitBreakerGuard({ maxRequests: 1 });

      const p1: LlmProvider = {
        name: 'mock',
        model: 'mock-economic',
        async generate() {
          return { text: '{"summary":"t1","findings":[]}', tokensIn: 50, tokensOut: 20 };
        },
      };

      const p2: LlmProvider = {
        name: 'mock',
        model: 'mock-powerful',
        async generate() {
          return { text: '{"summary":"t2","findings":[]}', tokensIn: 100, tokensOut: 50 };
        },
      };

      const guardedT1 = createGuardedProvider(p1, guard);
      const guardedT2 = createGuardedProvider(p2, guard);

      // Call Tier 1
      await guardedT1.generate({ system: 'sys', prompt: 'test', json: true });
      expect(guard.getStats().currentRequests).toBe(1);

      // Tier 2 escalation must be blocked because maxRequests (1) is exhausted
      await expect(
        guardedT2.generate({ system: 'sys', prompt: 'test escalation', json: true })
      ).rejects.toThrow('request ceiling of 1 reached');
    });

    it('free_tier_priority: variant is recognized and strictly enforces CLI limits', async () => {
      const runner = new BenchmarkRunner({
        limits: {
          maxRequests: 3,
          maxTokens: 10000,
          maxCostUsd: 0.20,
        },
      });

      const testCase: BenchmarkCase = {
        id: 'flask-sql-injection',
        name: 'flask-sql-injection',
        diff: 'diff --git a/app.py b/app.py\n+ query = f"SELECT * FROM users WHERE name = {user_input}"',
        spec: {
          expected: [
            { file: 'app.py', lines: [1, 2], severity: 'critical', issue: 'SQL Injection' },
          ],
        },
      };

      const res = await runner.runVariant('free_tier_priority', [testCase], async () => {
        return {
          findings: [{ filePath: 'app.py', lineStart: 1, lineEnd: 2, severity: 'critical' }],
          llmCalls: [
            {
              provider: 'gemini',
              model: 'gemini-2.0-flash',
              tier: 'tier1',
              tokensIn: 350,
              tokensOut: 90,
            },
          ],
          durationMs: 120,
        };
      });

      expect(res.variantKey).toBe('free_tier_priority');
      expect(res.totalLlmCalls).toBe(1);
      expect(res.realTokensIn).toBe(350);
      expect(res.realCostUsd).toBe(0); // Free model cost is $0.00
      expect(res.quality.recall).toBe(1.0);
      expect(runner.guard.getStats().currentRequests).toBe(1);
      expect(runner.guard.getStats().currentTokens).toBe(440);
    });
  });
});
