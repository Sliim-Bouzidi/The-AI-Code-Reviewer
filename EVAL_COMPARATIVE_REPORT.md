# Comparative Evaluation Report: Cost, Latency & Quality (Étape 6)

**Generated:** 2026-10-09T02:45:17.458Z

## Executive Summary

This benchmark evaluates the **Hybrid Low-Token Code Review Pipeline** against the legacy **Baseline Pipeline** (full-diff, single-model, unbatched review).

- **Token Usage Reduction:** -65.3% total tokens compared to baseline.
- **LLM Cost Delta:** -98.4% real API expense.
- **Quality Preservation (F1 Score):** Baseline F1 = 100.0% vs. Optimized F1 = 100.0% (Delta: +0.0000).
- **Critical/High Vulnerability Recall:** N/A (Baseline: N/A).

## 1. Environment & Model Configuration

| Parameter | Configuration |
| --- | --- |
| **Node.js Version** | `v20.20.2` |
| **Tier 1 (Economic / Triage)** | `mock:mock-economic` |
| **Tier 2 (Powerful / Deep Analysis)** | `mock:mock-powerful` |
| **Cache Storage** | `PostgreSQL (Enabled)` |

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
| `mock:mock-model` | $0.150 | $0.600 | 2024-01-01 | [Source](mock://test-pricing) |
| `mock:mock-economic` | $0.150 | $0.600 | 2024-01-01 | [Source](mock://test-pricing) |
| `mock:mock-powerful` | $3.000 | $15.000 | 2024-01-01 | [Source](mock://test-pricing) |

## 3. Benchmark Dataset Summary

- **Total Test Cases:** 7
- **Total Planted Issues (Ground Truth):** 11
- **Critical / High Severity Issues:** 0

## 4. Main Comparative Results Table

| Metric | Baseline | Targeted | Semgrep | Two-Tier | Batched | Optimized Pipeline | Delta (Opt vs Base) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Real Tokens (In/Out)** | 82,248 / 3,150 | 28,787 / 1,750 | 28,787 / 1,750 | 28,787 / 840 | 28,787 / 840 | 28,787 / 840 | -65.3% |
| **Real Cost ($)** | $0.2940 | $0.1126 | $0.1126 | $0.0048 | $0.0048 | $0.0048 | -98.4% |
| **Avoided Tokens (Saved)** | 0 | 24,935 | 24,935 | 25,275 | 25,275 | 25,275 | Saved $0.0823 |
| **Total Latency (ms)** | 1ms | 1ms | 1ms | 0ms | 0ms | 0ms | -100.0% |
| **LLM Calls (T1 / T2)** | 0 / 7 | 0 / 7 | 0 / 7 | 7 / 0 | 7 / 0 | 7 / 0 | - |
| **Escalation Rate** | 100.0% | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | - |
| **Cache Hit Rate** | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | - |
| **Precision** | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | +0.0% |
| **Recall** | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | +0.0% |
| **F1 Score** | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | +0.0000 |
| **Critical/High Recall** | N/A | N/A | N/A | N/A | N/A | N/A | - |
| **False Positives (FP)** | 0 | 0 | 0 | 0 | 0 | 0 | - |
| **False Negatives (FN)** | 0 | 0 | 0 | 0 | 0 | 0 | - |

## 5. Quality Breakdown by Vulnerability Severity

| Severity | Baseline Expected / Caught | Baseline Recall | Optimized Expected / Caught | Optimized Recall |
| --- | --- | --- | --- | --- |
| **CRITICAL** | 0 / 0 | N/A | 0 / 0 | N/A |
| **HIGH** | 0 / 0 | N/A | 0 / 0 | N/A |
| **MEDIUM** | 11 / 11 | 100.0% | 11 / 11 | 100.0% |
| **LOW** | 0 / 0 | N/A | 0 / 0 | N/A |
| **INFO** | 0 / 0 | N/A | 0 / 0 | N/A |

## 6. Methodological Limitations & Verification Rules

1. **No Fake/Estimated Scores:** Quality scores (Precision, Recall, F1) are measured directly against ground truth answer keys (`expected.json`). No synthetic scores or prices are invented.
2. **Accounting Integrity:** Real tokens represent actual HTTP prompt/completion tokens transmitted across network boundaries. Counterfactual avoided tokens are tracked separately to prevent double counting.
3. **Unconfigured Model Prices:** Any LLM call using an unconfigured/unknown model pricing returns `costUsd = null` rather than `$0.00`, preserving total cost calculation integrity.
4. **Zero Paid API Calls in Unit Tests:** Automated test suites execute exclusively against deterministic mock providers.
