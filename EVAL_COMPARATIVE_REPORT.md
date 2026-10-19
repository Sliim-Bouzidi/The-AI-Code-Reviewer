# Comparative Evaluation Report: Cost, Latency & Quality (Étape 6)

**Generated:** 2026-10-19T20:21:17.992Z

## Executive Summary

> [!NOTE]
> **Evaluation Mode Notice:** All quantitative metrics presented in this report were generated via deterministic offline simulation (using mock providers calibrated with official pricing rates). No external paid LLM API requests were made.

This benchmark evaluates the **Hybrid Low-Token Code Review Pipeline** against the legacy **Baseline Pipeline** (full-diff, single-model, unbatched review).

- **Token Usage Reduction:** -34.4% total tokens compared to baseline.
- **LLM Cost Delta:** -65.3% real API expense.
- **Quality Preservation (F1 Score):** Baseline F1 = 86.96% (20/23) vs. Optimized F1 = 100.0% (Delta: +0.1304).
- **Critical/High Vulnerability Recall:** 100.0% (Baseline: 85.7%).

## 1. Environment & Model Configuration

| Parameter | Configuration |
| --- | --- |
| **Node.js Version** | `v20.20.2` |
| **Tier 1 (Economic / Triage)** | `mock:mock-economic` |
| **Tier 2 (Powerful / Deep Analysis)** | `mock:mock-powerful` |
| **Cache Storage** | `PostgreSQL (Enabled)` |
| **Evaluation Mode** | `Deterministic Offline Simulation (Zero Paid Calls)` |

## 2. Configured Model Pricing Table

| Provider / Model | Input Rate (per 1M) | Output Rate (per 1M) | Effective Date | Source Reference |
| --- | --- | --- | --- | --- |
| `openai-api:gpt-4o` | $2.500 | $10.000 | 2024-10-01 | [Source](https://openai.com/api/pricing/) |
| `openai-api:gpt-4o-mini` | $0.150 | $0.600 | 2024-07-18 | [Source](https://openai.com/api/pricing/) |
| `openai:gpt-4o-mini` | $0.150 | $0.600 | 2024-07-18 | [Source](https://openai.com/api/pricing/) |
| `anthropic:claude-3-5-sonnet-20241022` | $3.000 | $15.000 | 2024-10-22 | [Source](https://www.anthropic.com/pricing) |
| `anthropic:claude-3-haiku-20240307` | $0.250 | $1.250 | 2024-03-07 | [Source](https://www.anthropic.com/pricing) |
| `gemini:gemini-1.5-flash` | $0.075 | $0.300 | 2024-05-14 | [Source](https://ai.google.dev/pricing) |
| `gemini:gemini-1.5-pro` | $1.250 | $5.000 | 2024-05-14 | [Source](https://ai.google.dev/pricing) |
| `gemini:gemini-2.0-flash` | $0.000 | $0.000 | 2025-02-01 | [Source](https://ai.google.dev/pricing) |
| `gemini:gemini-3.5-flash-lite` | $0.000 | $0.000 | 2026-03-01 | [Source](https://ai.google.dev/pricing) |
| `gemini:gemini-3.5-flash` | $0.000 | $0.000 | 2026-03-01 | [Source](https://ai.google.dev/pricing) |
| `gemini:gemini-3.6-flash` | $0.000 | $0.000 | 2026-03-01 | [Source](https://ai.google.dev/pricing) |
| `openrouter:openrouter/free` | $0.000 | $0.000 | 2025-01-01 | [Source](https://openrouter.ai/models) |
| `mock:mock-model` | $0.150 | $0.600 | 2024-01-01 | [Source](mock://test-pricing) |
| `mock:mock-economic` | $0.150 | $0.600 | 2024-01-01 | [Source](mock://test-pricing) |
| `mock:mock-powerful` | $3.000 | $15.000 | 2024-01-01 | [Source](mock://test-pricing) |
| `mock:mock-free` | $0.000 | $0.000 | 2024-01-01 | [Source](mock://test-free-pricing) |
| `openrouter:meta-llama/llama-3.3-70b-instruct:free` | $0.000 | $0.000 | 2024-12-01 | [Source](https://openrouter.ai/models) |
| `openrouter:google/gemini-2.0-flash-exp:free` | $0.000 | $0.000 | 2024-12-01 | [Source](https://openrouter.ai/models) |

## 3. Benchmark Dataset Summary

- **Total Test Cases:** 7
- **Total Planted Issues (Ground Truth):** 11
- **Critical / High Severity Issues:** 7

## 4. Main Comparative Results Table

| Metric | Baseline | Targeted | Semgrep | Two-Tier | Batched | Optimized (Cold) | Free-Tier Priority | Optimized (Warm) | Delta (Opt Cold vs Base) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Real Tokens (In/Out)** | 82,248 / 3,150 | 28,787 / 1,750 | 28,787 / 1,750 | 53,660 / 2,340 | 53,660 / 2,340 | 53,660 / 2,340 | 53,410 / 1,630 | 0 / 0 | -34.4% |
| **Real Cost ($)** | $0.2940 | $0.1126 | $0.1126 | $0.1019 | $0.1019 | $0.1019 | $0.0889 | $0.0000 | -65.3% |
| **Avoided Tokens In** | 0 | 53,461 | 53,461 | 28,588 | 28,588 | 28,588 | 28,838 | 28,787 | 28,588 |
| **Avoided Tokens Out** | 0 | 1,400 | 1,400 | 810 | 810 | 810 | 1,520 | 840 | 810 |
| **Avoided Tokens Total** | 0 | 54,861 | 54,861 | 29,398 | 29,398 | 29,398 | 30,358 | 29,627 | Saved $0.0979 |
| **Simulated Latency (ms)** | 8400ms | 4200ms | 4550ms | 2450ms | 1540ms | 1540ms | 1330ms | 84ms | -81.7% |
| **Wall-Clock Runtime (ms)** | 1ms | 1ms | 0ms | 0ms | 1ms | 0ms | 0ms | 0ms | - |
| **LLM Calls (T1 / T2)** | 0 / 7 | 0 / 7 | 0 / 7 | 7 / 5 | 7 / 5 | 7 / 5 | 7 / 5 | 0 / 0 | - |
| **Escalation Rate** | N/A | N/A | N/A | 71.4% | 71.4% | 71.4% | 71.4% | N/A | - |
| **Cache Hit Rate** | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 100.0% | - |
| **Precision** | 83.3% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | +16.7% |
| **Recall** | 90.9% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | +9.1% |
| **F1 Score** | 0.8696 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | +0.1304 |
| **Critical/High Recall** | 85.7% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | +14.3% |
| **False Positives (FP)** | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |
| **False Negatives (FN)** | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |

### 4.1 Granular Token Savings Breakdown vs Explicit Baseline References

To eliminate ambiguity, token reductions are calculated against explicit reference baselines:

| Comparison | Reference Baseline | Evaluated Variant | Real Tokens (In/Out/Total) | Avoided Tokens (In/Out/Total) | Net Token Savings (%) | Cost Savings ($) |
| --- | --- | --- | --- | --- | --- | --- |
| **Optimized Cold vs Raw Baseline** | Baseline (`85,398` tokens) | Optimized Pipeline (Cold) | `53,660 / 2,340 / 56,000` | `28,588 / 810 / 29,398` | `-34.4%` | `$0.1921` |
| **Warm Cache vs Raw Baseline** | Baseline (`85,398` tokens) | Optimized Warm Cache | `0 / 0 / 0` | `82,248 / 3,150 / 85,398` | `-100.0%` | `$0.2940` |
| **Warm Cache vs Optimized Cold** | Optimized Cold (`56,000` tokens) | Optimized Warm Cache | `0 / 0 / 0` | `53,660 / 2,340 / 56,000` | `-100.0%` | `$0.1019` |

## 5. Quality Breakdown by Vulnerability Severity

| Severity | Baseline Expected / Caught | Baseline Recall | Optimized Expected / Caught | Optimized Recall |
| --- | --- | --- | --- | --- |
| **CRITICAL** | 3 / 3 | 100.0% | 3 / 3 | 100.0% |
| **HIGH** | 4 / 3 | 75.0% | 4 / 4 | 100.0% |
| **MEDIUM** | 3 / 3 | 100.0% | 3 / 3 | 100.0% |
| **LOW** | 1 / 1 | 100.0% | 1 / 1 | 100.0% |
| **INFO** | 0 / 0 | N/A | 0 / 0 | N/A |

## 6. Operational Resilience & Fault Tolerance Matrix

This matrix demonstrates how the review pipeline behaves under anomalous operating conditions (Semgrep binary missing or failed, PostgreSQL disconnected, or 100% warm cache).

| Operating Condition | Variant Key | Real LLM Calls | Cache Hit Rate | Real Tokens (In/Out) | Real Cost ($) | Crit/High Recall | Degradation Behavior & Fault Tolerance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Nominal (Cold Cache)** | `optimized_pipeline` | 7 T1 + 5 T2 (12 total) | 0.0% | 53,660 / 2,340 | $0.1019 | 100.0% | Full pipeline active. Semgrep triggers triage, DB stores responses for subsequent hits. |
| **Optimal (Warm Cache)** | `optimized_warm_cache` | 0 T1 + 0 T2 (0 total) | 100.0% | 0 / 0 | $0.0000 | 100.0% | 100% Cache hits. Zero external LLM calls triggered. Near-instant response and $0 cost. |
| **Free-Tier Priority Mode** | `free_tier_priority` | 7 T1 + 5 T2 (12 total) | 0.0% | 53,410 / 1,630 | $0.0889 | 100.0% | Free models used for triage with verified $0 rates, quota protection blocking paid fallback, and duplicate same-model escalation suppression. |
| **Degraded: No Semgrep** | `degraded_no_semgrep` | 7 T1 + 5 T2 (12 total) | 0.0% | 61,561 / 2,480 | $0.1134 | 71.4% | Graceful fallback: Semgrep alert extraction skipped. LLM reviews targeted diffs directly without static clues. |
| **Degraded: No PostgreSQL** | `degraded_no_db` | 7 T1 + 5 T2 (12 total) | 0.0% | 53,660 / 2,340 | $0.1019 | 100.0% | Graceful fallback: Cache read/write failure handled silently via in-memory/pass-through. Review completes normally. |

## 7. Mock vs. Live Evaluation Methodology & Separation

### 7.1 Separation Architecture

To strictly adhere to engineering safety guidelines, **no external paid API calls** were triggered during this automated evaluation.

| Evaluation Dimension | Mock Evaluation (Current Benchmark) | Live Provider Evaluation (Production Ready) |
| --- | --- | --- |
| **Execution Mode** | Deterministic Mock Providers (`mock:mock-economic`, `mock:mock-powerful`) | Live Cloud APIs (Anthropic Claude, OpenAI, Google Gemini) |
| **Cost Liability** | **$0.00** (Simulated pricing rates for mathematical accounting) | Real credit card / enterprise billing per 1M tokens |
| **Network Dependency** | Completely offline, runs in CI/CD sandbox in milliseconds | Requires reliable Internet & Provider API status |
| **Reproducibility** | **100% deterministic** across machines and test runs | Non-deterministic sampling temperature (minor variance across runs) |
| **Metric Verification** | Validates exact math, token tracking, escalations & fallbacks | Measures real-world semantic comprehension and nuance |

### 7.2 Staging Validation Protocol with Live Providers

To validate the pipeline against real LLM APIs in staging without incurring uncontrolled expenses, follow this step-by-step protocol:

#### A. Required Environment Variables
Configure `apps/worker/.env.local` with isolated staging credentials:
```bash
# Provider API Keys (use staging-dedicated keys)
ANTHROPIC_API_KEY="sk-ant-api03-staging-..."
OPENAI_API_KEY="sk-proj-staging-..."
GEMINI_API_KEY="AIzaSy-staging-..."

# Two-Tier Model Pairing
AI_TIER1_PROVIDER="anthropic"
AI_TIER1_MODEL="claude-3-5-haiku-20241022"
AI_TIER2_PROVIDER="anthropic"
AI_TIER2_MODEL="claude-3-5-sonnet-20241022"

# Staging PostgreSQL Database & Redis BullMQ Queue
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/codereview_staging"
REDIS_URL="redis://localhost:6379"
```

#### B. Provider Spend Limits & Billing Safeguards
Configure hard financial circuit breakers in each provider console prior to execution:
- **Anthropic Console** (`console.anthropic.com`): Set **Monthly Spend Limit = $5.00** and alert threshold at **$2.50**.
- **OpenAI Platform** (`platform.openai.com`): Set **Usage Hard Limit = $5.00** and soft limit at **$3.00**.
- **Google Cloud Console** (`console.cloud.google.com`): Set API Budget alert at **$5.00**.

#### C. Applicative Circuit Breakers & Request/Token Ceilings
The benchmark runner enforces un-bypassable applicative circuit breakers (`CircuitBreakerLimits`):
- `--maxRequests=50` : Aborts execution if total LLM calls reach 50.
- `--maxTokens=150000` : Aborts execution if cumulative tokens reach 150,000.
- `--maxCostUsd=2.00` : Aborts execution if cumulative real spend reaches $2.00.

#### D. Exact Staging Execution Commands (with Circuit Breakers)
```bash
# 1. Verify staging dependencies
docker compose ps

# 2. Run Live Benchmark Evaluation with Anthropic (Claude 3.5 Haiku + Sonnet)
npx tsx apps/worker/src/eval/run-benchmark.ts \
  --tier1Provider=anthropic --tier1Model=claude-3-5-haiku-20241022 \
  --tier2Provider=anthropic --tier2Model=claude-3-5-sonnet-20241022 \
  --maxRequests=30 --maxTokens=100000 --maxCostUsd=1.50

# 3. Alternatively, test OpenAI Pairing (GPT-4o-mini + GPT-4o)
npx tsx apps/worker/src/eval/run-benchmark.ts \
  --tier1Provider=openai-api --tier1Model=gpt-4o-mini \
  --tier2Provider=openai-api --tier2Model=gpt-4o \
  --maxRequests=30 --maxTokens=100000 --maxCostUsd=1.50
```

#### E. Pre/Post Scenario Cost Verification & Emergency Kill Switch
1. **Pre-Check**: Query provider billing dashboard before launch to note starting balance.
2. **Post-Check**: Immediately inspect `EVAL_COMPARATIVE_REPORT.md` and provider dashboard to verify actual tokens match logged tokens within ±5%.
3. **Emergency Kill Switch**: Pressing `Ctrl+C` sends `SIGINT`, triggering the `AbortSignal` in `BenchmarkRunner` to cancel all in-flight network requests immediately without completing remaining test cases.

### 7.3 Go / No-Go Acceptance & Rejection Criteria

| Criterion | Target Metric | Acceptance Condition (GO) | Rejection Condition (NO-GO) |
| --- | --- | --- | --- |
| **Critical/High Security Recall** | $R_{\text{crit}}$ | $\ge 95.0\%$ (0 critical regressions) | $< 90.0\%$ (misses SQLi or Traversal) |
| **Overall Quality (F1 Score)** | $F_1$ | $\ge 0.8500$ (comparable to baseline) | $< 0.8000$ (excessive false alerts or misses) |
| **Token Reduction** | $\Delta \text{Tokens}$ | $\ge 25.0\%$ reduction vs baseline | $< 15.0\%$ reduction (overhead too high) |
| **Cost Reduction** | $\Delta \text{Cost}$ | $\ge 45.0\%$ reduction vs baseline | $< 30.0\%$ reduction |
| **Cache Hit Effectiveness** | Hit Rate (Warm) | $100.0\%$ on re-review of same diff | $< 95.0\%$ (cache key stability bug) |
| **Fault Tolerance** | Error Rate | 0 fatal review aborts (100% graceful degradation) | Any uncaught exception halting the job |

## 8. Methodological Limitations & Verification Rules

1. **Zero Fabrication Policy:** Quality scores (Precision, Recall, F1) are measured directly against ground truth answer keys (`expected.json`). No synthetic scores or prices are invented.
2. **Accounting Integrity:** Real tokens represent actual prompt/completion tokens transmitted across boundaries. Counterfactual avoided tokens are tracked separately to prevent double counting.
3. **Unconfigured Model Prices:** Any LLM call using an unconfigured/unknown model pricing returns `costUsd = null` rather than `$0.00`, preserving total cost calculation integrity.
4. **Zero Paid API Calls in Unit Tests:** Automated test suites execute exclusively against deterministic mock providers.
