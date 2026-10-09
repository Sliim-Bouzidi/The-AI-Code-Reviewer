import type { Severity } from '@codereview/shared';
import type { EvalSpec, QualityMetrics, ScoredFinding } from './scoring.js';
import { aggregateQualityMetrics } from './scoring.js';
import { calculateCallCostUsd } from './pricing.js';

export type VariantKey =
  | 'baseline'
  | 'targeted_context'
  | 'semgrep_integration'
  | 'two_tier_routing'
  | 'batched_routing'
  | 'optimized_pipeline';

export interface BenchmarkCase {
  id: string;
  name: string;
  diff: string;
  spec: EvalSpec;
  semgrepAlerts?: Array<{
    ruleId: string;
    path: string;
    lineStart: number;
    lineEnd?: number;
    severity: Severity;
    message: string;
  }>;
}

export interface VariantBenchmarkResult {
  variantKey: VariantKey;
  name: string;
  description: string;
  durationMs: number;
  totalLlmCalls: number;
  tier1Calls: number;
  tier2Calls: number;
  tier2EscalationRate: number | null;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number | null;
  realTokensIn: number;
  realTokensOut: number;
  realCostUsd: number | null;
  savedTokensIn: number;
  savedTokensOut: number;
  estimatedSavedCostUsd: number | null;
  quality: QualityMetrics;
}

export interface ComparativeBenchmarkReportData {
  timestamp: string;
  environment: {
    nodeVersion: string;
    tier1Provider: string;
    tier1Model: string;
    tier2Provider: string;
    tier2Model: string;
    cacheEnabled: boolean;
  };
  datasetSummary: {
    totalCases: number;
    totalPlantedIssues: number;
    criticalHighIssues: number;
  };
  pricingTable: Array<{
    provider: string;
    model: string;
    inputUsdPer1M: number;
    outputUsdPer1M: number;
    effectiveDate: string;
    source: string;
  }>;
  results: Record<VariantKey, VariantBenchmarkResult>;
}

export interface MockLlmCallRecord {
  provider: string;
  model: string;
  tier: 'tier1' | 'tier2';
  tokensIn: number;
  tokensOut: number;
  isCacheHit?: boolean;
}

/**
 * Runner that executes benchmark variants on test fixtures.
 */
export class BenchmarkRunner {
  private tier1Provider: string;
  private tier1Model: string;
  private tier2Provider: string;
  private tier2Model: string;

  constructor(opts?: {
    tier1Provider?: string;
    tier1Model?: string;
    tier2Provider?: string;
    tier2Model?: string;
  }) {
    this.tier1Provider = opts?.tier1Provider ?? 'mock';
    this.tier1Model = opts?.tier1Model ?? 'mock-economic';
    this.tier2Provider = opts?.tier2Provider ?? 'mock';
    this.tier2Model = opts?.tier2Model ?? 'mock-powerful';
  }

  /**
   * Evaluates a single variant on the given dataset of cases.
   */
  public runVariant(
    variantKey: VariantKey,
    cases: BenchmarkCase[],
    executor: (
      variantKey: VariantKey,
      c: BenchmarkCase
    ) => Promise<{
      findings: ScoredFinding[];
      llmCalls: MockLlmCallRecord[];
      durationMs: number;
      baselineTokensIn?: number;
      baselineTokensOut?: number;
    }>
  ): Promise<VariantBenchmarkResult> {
    const startTime = Date.now();
    const scoredCases: Array<{ spec: EvalSpec; found: ScoredFinding[] }> = [];

    let totalLlmCalls = 0;
    let tier1Calls = 0;
    let tier2Calls = 0;
    let cacheHits = 0;
    let cacheMisses = 0;

    let realTokensIn = 0;
    let realTokensOut = 0;
    let realCostUsd: number | null = 0;

    let savedTokensIn = 0;
    let savedTokensOut = 0;
    let estimatedSavedCostUsd: number | null = 0;

    return (async () => {
      for (const c of cases) {
        const res = await executor(variantKey, c);
        scoredCases.push({ spec: c.spec, found: res.findings });

        for (const call of res.llmCalls) {
          if (call.isCacheHit) {
            cacheHits += 1;
            // Avoiding network call via cache saves tokens
            savedTokensIn += call.tokensIn;
            savedTokensOut += call.tokensOut;
            const savedCostRes = calculateCallCostUsd(call.provider, call.model, call.tokensIn, call.tokensOut);
            if (savedCostRes.costUsd !== null && estimatedSavedCostUsd !== null) {
              estimatedSavedCostUsd += savedCostRes.costUsd;
            }
          } else {
            cacheMisses += 1;
            totalLlmCalls += 1;
            if (call.tier === 'tier1') tier1Calls += 1;
            if (call.tier === 'tier2') tier2Calls += 1;

            realTokensIn += call.tokensIn;
            realTokensOut += call.tokensOut;

            const costRes = calculateCallCostUsd(call.provider, call.model, call.tokensIn, call.tokensOut);
            if (costRes.costUsd !== null && realCostUsd !== null) {
              realCostUsd += costRes.costUsd;
            } else {
              // If any model's cost is unknown, set total realCostUsd to null to avoid underreporting
              realCostUsd = null;
            }
          }
        }

        // Track saved tokens from context reduction (baseline full diff vs targeted context)
        if (res.baselineTokensIn && res.baselineTokensIn > realTokensIn) {
          const deltaIn = res.baselineTokensIn - realTokensIn;
          const deltaOut = Math.max(0, (res.baselineTokensOut ?? 0) - realTokensOut);
          savedTokensIn += deltaIn;
          savedTokensOut += deltaOut;
          const costSaved = calculateCallCostUsd(this.tier2Provider, this.tier2Model, deltaIn, deltaOut);
          if (costSaved.costUsd !== null && estimatedSavedCostUsd !== null) {
            estimatedSavedCostUsd += costSaved.costUsd;
          }
        }
      }

      const quality = aggregateQualityMetrics(scoredCases);
      const totalCallsEvaluated = tier1Calls + tier2Calls;
      const tier2EscalationRate = totalCallsEvaluated > 0 ? Number((tier2Calls / totalCallsEvaluated).toFixed(4)) : null;
      const totalCacheAttempts = cacheHits + cacheMisses;
      const cacheHitRate = totalCacheAttempts > 0 ? Number((cacheHits / totalCacheAttempts).toFixed(4)) : null;

      const variantMetadata: Record<VariantKey, { name: string; description: string }> = {
        baseline: {
          name: 'Baseline Pipeline',
          description: 'Full diff in prompt, no Semgrep prompt integration, 1 file per call, Tier 2 model only, no cache.',
        },
        targeted_context: {
          name: 'Targeted Context',
          description: 'AST/symbol targeted context extraction, 1 file per call, Tier 2 model, no cache.',
        },
        semgrep_integration: {
          name: 'Semgrep Prompt Integration',
          description: 'Targeted context + Semgrep alerts in prompt with 3-state decisions (CONFIRMED, REJECTED, UNCERTAIN).',
        },
        two_tier_routing: {
          name: 'Two-Tier Routing',
          description: 'Economic Tier 1 model for triage + Powerful Tier 2 model escalation for high/critical/uncertain cases.',
        },
        batched_routing: {
          name: 'Multi-File Batching',
          description: 'Targeted context + Semgrep integration + Two-tier routing + Multi-file batching.',
        },
        optimized_pipeline: {
          name: 'Optimized Pipeline (Full)',
          description: 'Targeted context + Semgrep integration + Two-tier routing + Multi-file batching + PostgreSQL Cache.',
        },
      };

      const meta = variantMetadata[variantKey];

      return {
        variantKey,
        name: meta.name,
        description: meta.description,
        durationMs: Date.now() - startTime,
        totalLlmCalls,
        tier1Calls,
        tier2Calls,
        tier2EscalationRate,
        cacheHits,
        cacheMisses,
        cacheHitRate,
        realTokensIn,
        realTokensOut,
        realCostUsd: realCostUsd !== null ? Number(realCostUsd.toFixed(6)) : null,
        savedTokensIn,
        savedTokensOut,
        estimatedSavedCostUsd: estimatedSavedCostUsd !== null ? Number(estimatedSavedCostUsd.toFixed(6)) : null,
        quality,
      };
    })();
  }
}
