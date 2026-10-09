import { describe, expect, it } from 'vitest';
import { calculateCallCostUsd, getPricingConfig } from './pricing.js';
import { aggregateQualityMetrics, calculateF1, ratio } from './scoring.js';
import type { EvalSpec, ScoredFinding } from './scoring.js';
import { BenchmarkRunner } from './benchmark-runner.js';
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
      expect(reportMarkdown).toContain('## 6. Methodological Limitations & Verification Rules');
      expect(reportMarkdown).toContain('Baseline Pipeline');
      expect(reportMarkdown).toContain('Optimized Pipeline');
    });

    it('loads synthetic default cases cleanly when evals directory is empty or missing', () => {
      const cases = loadBenchmarkCases();
      expect(cases.length).toBeGreaterThan(0);
      expect(cases[0].spec.expected.length).toBeGreaterThan(0);
    });
  });
});
