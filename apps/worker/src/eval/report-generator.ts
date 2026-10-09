import type { ComparativeBenchmarkReportData, VariantBenchmarkResult, VariantKey } from './benchmark-runner.js';
import { getPricingConfig } from './pricing.js';

/**
 * Formats a comprehensive Markdown benchmark report comparing Baseline vs Optimized Pipeline.
 */
export function generateBenchmarkReport(data: ComparativeBenchmarkReportData): string {
  const { environment, datasetSummary, pricingTable, results } = data;
  const baseline = results.baseline;
  const optimized = results.optimized_pipeline ?? results[Object.keys(results)[Object.keys(results).length - 1] as VariantKey];

  const formatCost = (val: number | null) => (val === null ? '`unknown`' : `$${val.toFixed(4)}`);
  const formatPct = (val: number | null) => (val === null ? 'N/A' : `${(val * 100).toFixed(1)}%`);
  const formatNum = (val: number) => val.toLocaleString('en-US');

  const calcDeltaPct = (opt: number, base: number) => {
    if (base === 0) return '0.0%';
    const pct = ((opt - base) / base) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  const lines: string[] = [];

  // Header
  lines.push('# Comparative Evaluation Report: Cost, Latency & Quality (Étape 6)');
  lines.push('');
  lines.push(`**Generated:** ${data.timestamp}`);
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push('');
  if (baseline && optimized) {
    const costReduction = baseline.realCostUsd !== null && optimized.realCostUsd !== null
      ? calcDeltaPct(optimized.realCostUsd, baseline.realCostUsd)
      : 'N/A';
    const tokenReduction = calcDeltaPct(
      optimized.realTokensIn + optimized.realTokensOut,
      baseline.realTokensIn + baseline.realTokensOut
    );
    const f1Delta = optimized.quality.f1Score !== null && baseline.quality.f1Score !== null
      ? `${(optimized.quality.f1Score - baseline.quality.f1Score) >= 0 ? '+' : ''}${(optimized.quality.f1Score - baseline.quality.f1Score).toFixed(4)}`
      : 'N/A';

    lines.push(
      `This benchmark evaluates the **Hybrid Low-Token Code Review Pipeline** against the legacy **Baseline Pipeline** (full-diff, single-model, unbatched review).`
    );
    lines.push('');
    lines.push(`- **Token Usage Reduction:** ${tokenReduction} total tokens compared to baseline.`);
    lines.push(`- **LLM Cost Delta:** ${costReduction} real API expense.`);
    lines.push(`- **Quality Preservation (F1 Score):** Baseline F1 = ${formatPct(baseline.quality.f1Score)} vs. Optimized F1 = ${formatPct(optimized.quality.f1Score)} (Delta: ${f1Delta}).`);
    lines.push(`- **Critical/High Vulnerability Recall:** ${formatPct(optimized.quality.criticalHighRecall)} (Baseline: ${formatPct(baseline.quality.criticalHighRecall)}).`);
  } else {
    lines.push('Comparative evaluation completed across configured pipeline variants.');
  }
  lines.push('');

  // Benchmark Environment Configuration
  lines.push('## 1. Environment & Model Configuration');
  lines.push('');
  lines.push('| Parameter | Configuration |');
  lines.push('| --- | --- |');
  lines.push(`| **Node.js Version** | \`${environment.nodeVersion}\` |`);
  lines.push(`| **Tier 1 (Economic / Triage)** | \`${environment.tier1Provider}:${environment.tier1Model}\` |`);
  lines.push(`| **Tier 2 (Powerful / Deep Analysis)** | \`${environment.tier2Provider}:${environment.tier2Model}\` |`);
  lines.push(`| **Cache Storage** | \`${environment.cacheEnabled ? 'PostgreSQL (Enabled)' : 'Disabled'}\` |`);
  lines.push('');

  // Pricing Table
  lines.push('## 2. Configured Model Pricing Table');
  lines.push('');
  lines.push('| Provider / Model | Input Rate (per 1M) | Output Rate (per 1M) | Effective Date | Source Reference |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const item of pricingTable) {
    lines.push(
      `| \`${item.provider}:${item.model}\` | $${item.inputUsdPer1M.toFixed(3)} | $${item.outputUsdPer1M.toFixed(3)} | ${item.effectiveDate} | [Source](${item.source}) |`
    );
  }
  lines.push('');

  // Dataset Characteristics
  lines.push('## 3. Benchmark Dataset Summary');
  lines.push('');
  lines.push(`- **Total Test Cases:** ${datasetSummary.totalCases}`);
  lines.push(`- **Total Planted Issues (Ground Truth):** ${datasetSummary.totalPlantedIssues}`);
  lines.push(`- **Critical / High Severity Issues:** ${datasetSummary.criticalHighIssues}`);
  lines.push('');

  // Main Comparative Table
  lines.push('## 4. Main Comparative Results Table');
  lines.push('');
  lines.push('| Metric | Baseline | Targeted | Semgrep | Two-Tier | Batched | Optimized Pipeline | Delta (Opt vs Base) |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');

  const keys: VariantKey[] = [
    'baseline',
    'targeted_context',
    'semgrep_integration',
    'two_tier_routing',
    'batched_routing',
    'optimized_pipeline',
  ];

  const getV = (k: VariantKey): VariantBenchmarkResult | undefined => results[k];

  // Helper row builder
  const makeRow = (
    label: string,
    getValueStr: (res?: VariantBenchmarkResult) => string,
    getDeltaStr?: () => string
  ) => {
    const cols = keys.map((k) => getValueStr(getV(k)));
    const delta = getDeltaStr ? getDeltaStr() : '-';
    return `| **${label}** | ${cols.join(' | ')} | ${delta} |`;
  };

  lines.push(
    makeRow(
      'Real Tokens (In/Out)',
      (res) => (res ? `${formatNum(res.realTokensIn)} / ${formatNum(res.realTokensOut)}` : '-'),
      () => {
        if (!baseline || !optimized) return '-';
        const bTot = baseline.realTokensIn + baseline.realTokensOut;
        const oTot = optimized.realTokensIn + optimized.realTokensOut;
        return calcDeltaPct(oTot, bTot);
      }
    )
  );

  lines.push(
    makeRow(
      'Real Cost ($)',
      (res) => (res ? formatCost(res.realCostUsd) : '-'),
      () => {
        if (!baseline || !optimized || baseline.realCostUsd === null || optimized.realCostUsd === null) return '-';
        return calcDeltaPct(optimized.realCostUsd, baseline.realCostUsd);
      }
    )
  );

  lines.push(
    makeRow(
      'Avoided Tokens (Saved)',
      (res) => (res ? `${formatNum(res.savedTokensIn + res.savedTokensOut)}` : '-'),
      () => (optimized ? `Saved ${formatCost(optimized.estimatedSavedCostUsd)}` : '-')
    )
  );

  lines.push(
    makeRow(
      'Total Latency (ms)',
      (res) => (res ? `${res.durationMs}ms` : '-'),
      () => (baseline && optimized ? calcDeltaPct(optimized.durationMs, baseline.durationMs) : '-')
    )
  );

  lines.push(
    makeRow(
      'LLM Calls (T1 / T2)',
      (res) => (res ? `${res.tier1Calls} / ${res.tier2Calls}` : '-')
    )
  );

  lines.push(
    makeRow(
      'Escalation Rate',
      (res) => (res ? formatPct(res.tier2EscalationRate) : '-')
    )
  );

  lines.push(
    makeRow(
      'Cache Hit Rate',
      (res) => (res ? formatPct(res.cacheHitRate) : '-')
    )
  );

  lines.push(
    makeRow(
      'Precision',
      (res) => (res ? formatPct(res.quality.precision) : '-'),
      () => {
        if (!baseline || !optimized || baseline.quality.precision === null || optimized.quality.precision === null) return '-';
        const delta = optimized.quality.precision - baseline.quality.precision;
        return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
      }
    )
  );

  lines.push(
    makeRow(
      'Recall',
      (res) => (res ? formatPct(res.quality.recall) : '-'),
      () => {
        if (!baseline || !optimized || baseline.quality.recall === null || optimized.quality.recall === null) return '-';
        const delta = optimized.quality.recall - baseline.quality.recall;
        return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
      }
    )
  );

  lines.push(
    makeRow(
      'F1 Score',
      (res) => (res ? (res.quality.f1Score !== null ? res.quality.f1Score.toFixed(4) : 'N/A') : '-'),
      () => {
        if (!baseline || !optimized || baseline.quality.f1Score === null || optimized.quality.f1Score === null) return '-';
        const delta = optimized.quality.f1Score - baseline.quality.f1Score;
        return `${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`;
      }
    )
  );

  lines.push(
    makeRow(
      'Critical/High Recall',
      (res) => (res ? formatPct(res.quality.criticalHighRecall) : '-'),
      () => {
        if (!baseline || !optimized || baseline.quality.criticalHighRecall === null || optimized.quality.criticalHighRecall === null) return '-';
        const delta = optimized.quality.criticalHighRecall - baseline.quality.criticalHighRecall;
        return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
      }
    )
  );

  lines.push(
    makeRow(
      'False Positives (FP)',
      (res) => (res ? `${res.quality.falsePositives}` : '-')
    )
  );

  lines.push(
    makeRow(
      'False Negatives (FN)',
      (res) => (res ? `${res.quality.falseNegatives}` : '-')
    )
  );

  lines.push('');

  // Severity Quality Breakdown Table
  lines.push('## 5. Quality Breakdown by Vulnerability Severity');
  lines.push('');
  lines.push('| Severity | Baseline Expected / Caught | Baseline Recall | Optimized Expected / Caught | Optimized Recall |');
  lines.push('| --- | --- | --- | --- | --- |');

  if (baseline && optimized) {
    const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
    for (const sev of severities) {
      const bSev = baseline.quality.severityBreakdown[sev];
      const oSev = optimized.quality.severityBreakdown[sev];
      lines.push(
        `| **${sev.toUpperCase()}** | ${bSev.expected} / ${bSev.caught} | ${formatPct(bSev.recall)} | ${oSev.expected} / ${oSev.caught} | ${formatPct(oSev.recall)} |`
      );
    }
  }
  lines.push('');

  // Methodological Limitations
  lines.push('## 6. Methodological Limitations & Verification Rules');
  lines.push('');
  lines.push('1. **No Fake/Estimated Scores:** Quality scores (Precision, Recall, F1) are measured directly against ground truth answer keys (`expected.json`). No synthetic scores or prices are invented.');
  lines.push('2. **Accounting Integrity:** Real tokens represent actual HTTP prompt/completion tokens transmitted across network boundaries. Counterfactual avoided tokens are tracked separately to prevent double counting.');
  lines.push('3. **Unconfigured Model Prices:** Any LLM call using an unconfigured/unknown model pricing returns `costUsd = null` rather than `$0.00`, preserving total cost calculation integrity.');
  lines.push('4. **Zero Paid API Calls in Unit Tests:** Automated test suites execute exclusively against deterministic mock providers.');
  lines.push('');

  return lines.join('\n');
}
