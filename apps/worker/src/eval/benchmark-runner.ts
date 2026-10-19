import type { Severity } from '@codereview/shared';
import type { LlmCallInput, LlmCallResult, LlmProvider } from '@codereview/llm';
import type { EvalSpec, QualityMetrics, ScoredFinding } from './scoring.js';
import { aggregateQualityMetrics } from './scoring.js';
import { calculateCallCostUsd } from './pricing.js';

export type VariantKey =
  | 'baseline'
  | 'targeted_context'
  | 'semgrep_integration'
  | 'two_tier_routing'
  | 'batched_routing'
  | 'optimized_pipeline'
  | 'optimized_warm_cache'
  | 'free_tier_priority'
  | 'degraded_no_semgrep'
  | 'degraded_no_db';

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
  wallClockDurationMs: number;
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
    isMockEvaluation?: boolean;
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

export class CircuitBreakerExceededError extends Error {
  constructor(
    message: string,
    public readonly metric: 'requests' | 'tokens' | 'cost' | 'abort',
    public readonly value: number
  ) {
    super(message);
    this.name = 'CircuitBreakerExceededError';
  }
}

export interface CircuitBreakerLimits {
  maxRequests?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  abortSignal?: AbortSignal;
}

export interface ReserveCallOptions {
  provider: string;
  model: string;
  estimatedTokensIn: number;
  maxOutputTokens?: number;
  tier?: 'tier1' | 'tier2';
}

export interface ReservedCallAllocation {
  id: string;
  provider: string;
  model: string;
  reservedTokensIn: number;
  reservedTokensOut: number;
  reservedCostUsd: number;
  release: (actual?: { tokensIn: number; tokensOut: number; costUsd?: number | null }) => void;
}

/**
 * Thread-safe and race-condition free circuit breaker guard.
 * Synchronously reserves budget before any network call starts, accounting for the maximum possible cost.
 */
export class CircuitBreakerGuard {
  private currentRequests = 0;
  private currentTokens = 0;
  private currentCostUsd = 0;

  // Active synchronous reservations for in-flight requests (prevents race condition)
  private reservedRequests = 0;
  private reservedTokens = 0;
  private reservedCostUsd = 0;

  constructor(public readonly limits?: CircuitBreakerLimits) {}

  public get abortSignal(): AbortSignal | undefined {
    return this.limits?.abortSignal;
  }

  public checkCeilings(upcomingRequests = 1, upcomingTokens = 0, upcomingCost = 0): void {
    if (this.limits?.abortSignal?.aborted) {
      throw new CircuitBreakerExceededError(
        'Emergency stop triggered: operator abort signal active',
        'abort',
        0
      );
    }
    const projectedRequests = this.currentRequests + this.reservedRequests + upcomingRequests;
    if (this.limits?.maxRequests !== undefined && projectedRequests > this.limits.maxRequests) {
      throw new CircuitBreakerExceededError(
        `Circuit breaker tripped: request ceiling of ${this.limits.maxRequests} reached (current: ${this.currentRequests + this.reservedRequests})`,
        'requests',
        projectedRequests
      );
    }
    const projectedTokens = this.currentTokens + this.reservedTokens + upcomingTokens;
    if (this.limits?.maxTokens !== undefined && (projectedTokens > this.limits.maxTokens || (this.currentTokens + this.reservedTokens) >= this.limits.maxTokens)) {
      throw new CircuitBreakerExceededError(
        `Circuit breaker tripped: token ceiling of ${this.limits.maxTokens} reached (current: ${this.currentTokens + this.reservedTokens})`,
        'tokens',
        projectedTokens
      );
    }
    const projectedCost = this.currentCostUsd + this.reservedCostUsd + upcomingCost;
    if (this.limits?.maxCostUsd !== undefined && (projectedCost > this.limits.maxCostUsd || (this.currentCostUsd + this.reservedCostUsd) >= this.limits.maxCostUsd)) {
      throw new CircuitBreakerExceededError(
        `Circuit breaker tripped: cost budget ceiling of $${this.limits.maxCostUsd.toFixed(2)} reached (current: $${(this.currentCostUsd + this.reservedCostUsd).toFixed(4)})`,
        'cost',
        projectedCost
      );
    }
  }

  /**
   * Reserves budget synchronously before an LLM call starts.
   * Calculates max possible tokens and max possible cost (input + max output tokens at provider rate).
   * Ensures that concurrent calls, retries, and Tier 2 escalations cannot bypass ceilings.
   */
  public reserveCall(opts: ReserveCallOptions): ReservedCallAllocation {
    const maxOutput = opts.maxOutputTokens ?? 4096;
    const maxPossibleTokens = opts.estimatedTokensIn + maxOutput;
    const pricingRes = calculateCallCostUsd(opts.provider, opts.model, opts.estimatedTokensIn, maxOutput);
    const maxPossibleCost = pricingRes.costUsd ?? 0;

    // Check ceilings before reserving
    this.checkCeilings(1, maxPossibleTokens, maxPossibleCost);

    // Atomically reserve synchronously before awaiting any I/O
    this.reservedRequests += 1;
    this.reservedTokens += maxPossibleTokens;
    this.reservedCostUsd += maxPossibleCost;

    let released = false;
    const release = (actual?: { tokensIn: number; tokensOut: number; costUsd?: number | null }) => {
      if (released) return;
      released = true;

      // Roll back the reservation
      this.reservedRequests -= 1;
      this.reservedTokens -= maxPossibleTokens;
      this.reservedCostUsd -= maxPossibleCost;

      // Commit actual consumption
      this.currentRequests += 1;
      if (actual) {
        this.currentTokens += actual.tokensIn + actual.tokensOut;
        if (actual.costUsd !== undefined && actual.costUsd !== null) {
          this.currentCostUsd += actual.costUsd;
        } else {
          const actualPricing = calculateCallCostUsd(opts.provider, opts.model, actual.tokensIn, actual.tokensOut);
          if (actualPricing.costUsd !== null) {
            this.currentCostUsd += actualPricing.costUsd;
          }
        }
      }
    };

    return {
      id: Math.random().toString(36).slice(2),
      provider: opts.provider,
      model: opts.model,
      reservedTokensIn: opts.estimatedTokensIn,
      reservedTokensOut: maxOutput,
      reservedCostUsd: maxPossibleCost,
      release,
    };
  }

  public commitExternalCall(tokensIn: number, tokensOut: number, costUsd: number | null): void {
    const totTokens = tokensIn + tokensOut;
    const cost = costUsd ?? 0;
    this.checkCeilings(1, totTokens, cost);
    this.currentRequests += 1;
    this.currentTokens += totTokens;
    if (costUsd !== null) {
      this.currentCostUsd += costUsd;
    }
  }

  public getStats() {
    return {
      currentRequests: this.currentRequests,
      currentTokens: this.currentTokens,
      currentCostUsd: Number(this.currentCostUsd.toFixed(6)),
      reservedRequests: this.reservedRequests,
      reservedTokens: this.reservedTokens,
      reservedCostUsd: Number(this.reservedCostUsd.toFixed(6)),
    };
  }
}

/**
 * Wraps an LlmProvider with CircuitBreakerGuard reservation.
 * Every call to generate() (including retries, escalations, or concurrent calls)
 * synchronously reserves tokens, request count, and cost against ceilings before dispatch.
 */
export function createGuardedProvider(
  provider: LlmProvider,
  guard: CircuitBreakerGuard
): LlmProvider {
  return {
    name: provider.name,
    model: provider.model,
    isFree: provider.isFree,
    async generate(input: LlmCallInput): Promise<LlmCallResult> {
      const estimatedTokensIn = Math.ceil(
        (input.prompt.length + (input.system?.length ?? 0)) / 4
      );
      const alloc = guard.reserveCall({
        provider: provider.name,
        model: provider.model,
        estimatedTokensIn,
        maxOutputTokens: input.maxOutputTokens ?? 1500,
      });
      try {
        const res = await provider.generate(input);
        alloc.release({ tokensIn: res.tokensIn, tokensOut: res.tokensOut });
        return res;
      } catch (err) {
        alloc.release();
        throw err;
      }
    },
  };
}

export interface BenchmarkRunnerOptions {
  tier1Provider?: string;
  tier1Model?: string;
  tier2Provider?: string;
  tier2Model?: string;
  limits?: CircuitBreakerLimits;
}

/**
 * Runner that executes benchmark variants on test fixtures.
 */
export class BenchmarkRunner {
  private tier1Provider: string;
  private tier1Model: string;
  private tier2Provider: string;
  private tier2Model: string;
  public readonly limits?: CircuitBreakerLimits;
  public readonly guard: CircuitBreakerGuard;

  constructor(opts?: BenchmarkRunnerOptions) {
    this.tier1Provider = opts?.tier1Provider ?? 'mock';
    this.tier1Model = opts?.tier1Model ?? 'mock-economic';
    this.tier2Provider = opts?.tier2Provider ?? 'mock';
    this.tier2Model = opts?.tier2Model ?? 'mock-powerful';
    this.limits = opts?.limits;
    this.guard = new CircuitBreakerGuard(this.limits);
  }

  /**
   * Evaluates a single variant on the given dataset of cases.
   */
  public runVariant(
    variantKey: VariantKey,
    cases: BenchmarkCase[],
    executor: (
      variantKey: VariantKey,
      c: BenchmarkCase,
      guard?: CircuitBreakerGuard
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
    let totalDurationMs = 0;

    let realTokensIn = 0;
    let realTokensOut = 0;
    let realCostUsd: number | null = 0;

    let savedTokensIn = 0;
    let savedTokensOut = 0;
    let estimatedSavedCostUsd: number | null = 0;

    return (async () => {
      for (const c of cases) {
        // Pre-check circuit breaker kill-switch and limits
        this.guard.checkCeilings(1, 0, 0);

        const initialGuardRequests = this.guard.getStats().currentRequests;

        const res = await executor(variantKey, c, this.guard);
        scoredCases.push({ spec: c.spec, found: res.findings });
        totalDurationMs += res.durationMs ?? 0;

        let caseRealIn = 0;
        let caseRealOut = 0;

        const callsAlreadyTracked = this.guard.getStats().currentRequests > initialGuardRequests;

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

            caseRealIn += call.tokensIn;
            caseRealOut += call.tokensOut;
            realTokensIn += call.tokensIn;
            realTokensOut += call.tokensOut;

            const costRes = calculateCallCostUsd(call.provider, call.model, call.tokensIn, call.tokensOut);
            if (costRes.costUsd !== null && realCostUsd !== null) {
              realCostUsd += costRes.costUsd;
            } else {
              // If any model's cost is unknown, set total realCostUsd to null to avoid underreporting
              realCostUsd = null;
            }

            if (!callsAlreadyTracked) {
              this.guard.commitExternalCall(call.tokensIn, call.tokensOut, costRes.costUsd);
            }
          }
        }

        // Post-call check on cost and tokens ceiling
        if (this.limits?.maxTokens && realTokensIn + realTokensOut >= this.limits.maxTokens) {
          throw new CircuitBreakerExceededError(
            `Circuit breaker tripped: token ceiling of ${this.limits.maxTokens} exceeded after case ${c.id} (current: ${realTokensIn + realTokensOut})`,
            'tokens',
            realTokensIn + realTokensOut
          );
        }
        if (this.limits?.maxCostUsd && realCostUsd !== null && realCostUsd >= this.limits.maxCostUsd) {
          throw new CircuitBreakerExceededError(
            `Circuit breaker tripped: cost budget ceiling of $${this.limits.maxCostUsd.toFixed(2)} exceeded after case ${c.id} (current: $${realCostUsd.toFixed(4)})`,
            'cost',
            realCostUsd
          );
        }

        // Track saved tokens from prompt context reduction (baseline full diff vs targeted context)
        // Only applies if the case actually executed real calls (if it hit cache, saved tokens were already counted above)
        if (caseRealIn > 0 && res.baselineTokensIn && res.baselineTokensIn > caseRealIn) {
          const deltaIn = res.baselineTokensIn - caseRealIn;
          const deltaOut = Math.max(0, (res.baselineTokensOut ?? 0) - caseRealOut);
          savedTokensIn += deltaIn;
          savedTokensOut += deltaOut;
          const costSaved = calculateCallCostUsd(this.tier2Provider, this.tier2Model, deltaIn, deltaOut);
          if (costSaved.costUsd !== null && estimatedSavedCostUsd !== null) {
            estimatedSavedCostUsd += costSaved.costUsd;
          }
        }
      }

      const quality = aggregateQualityMetrics(scoredCases);
      // Escalation rate is the fraction of Tier-1 triage calls that were escalated to Tier-2
      const tier2EscalationRate = tier1Calls > 0 ? Number((tier2Calls / tier1Calls).toFixed(4)) : null;
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
          name: 'Optimized Pipeline (Cold Cache)',
          description: 'Targeted context + Semgrep integration + Two-tier routing + Multi-file batching + PostgreSQL Cache.',
        },
        optimized_warm_cache: {
          name: 'Optimized Pipeline (Warm Cache)',
          description: 'Subsequent review of identical diff; 100% cache hit, 0 LLM calls, zero real token expense.',
        },
        free_tier_priority: {
          name: 'Free-Tier Priority Mode',
          description: 'Free models used for triage with verified free-tier limits, same-model escalation suppression, and strict quota protection blocking paid fallbacks.',
        },
        degraded_no_semgrep: {
          name: 'Degraded Mode: No Semgrep',
          description: 'Static analysis unavailable or binary missing; pipeline falls back gracefully to targeted diff analysis.',
        },
        degraded_no_db: {
          name: 'Degraded Mode: No PostgreSQL',
          description: 'Database connection failure; store falls back gracefully to in-memory cache without failing reviews.',
        },
      };

      const meta = variantMetadata[variantKey];

      return {
        variantKey,
        name: meta.name,
        description: meta.description,
        durationMs: totalDurationMs > 0 ? totalDurationMs : (Date.now() - startTime),
        wallClockDurationMs: Date.now() - startTime,
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
