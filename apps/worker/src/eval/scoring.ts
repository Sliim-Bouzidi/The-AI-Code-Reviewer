import type { Severity } from '@codereview/shared';

/** One planted issue in an eval case's expected.json (the answer key). */
export interface ExpectedIssue {
  file: string;
  lines: [number, number];
  category?: string;
  issue: string;
  severity?: Severity;
}

export interface EvalSpec {
  description?: string;
  expected: ExpectedIssue[];
  /** On a clean case, findings up to this severity are tolerated (default: info). */
  max_severity_ok?: Severity;
}

export interface ScoredFinding {
  filePath: string;
  lineStart: number;
  lineEnd: number | null;
  severity: Severity;
  category?: string;
}

export interface CaseScore {
  expected: number;
  caught: number;
  findings: number;
  onTarget: number;
  falseAlarms: number;
  missed: string[];
}

/** Severity level breakdown for detailed precision/recall analysis. */
export interface SeverityMetrics {
  expected: number;
  caught: number;
  recall: number | null;
}

/** Quality evaluation metrics aggregated across multiple benchmark cases. */
export interface QualityMetrics {
  totalExpected: number;
  totalCaught: number;
  totalFindings: number;
  totalOnTarget: number;
  falsePositives: number; // FP (findings not on target or clean case violations)
  falseNegatives: number; // FN (expected issues missed)
  precision: number | null;
  recall: number | null;
  f1Score: number | null;
  criticalHighExpected: number;
  criticalHighCaught: number;
  criticalHighRecall: number | null;
  severityBreakdown: Record<Severity, SeverityMetrics>;
  categoryBreakdown: Record<string, { expected: number; caught: number; recall: number | null }>;
}

/** A finding counts as a hit when it is in the same file and within 2 lines of the expected range. */
export const TOLERANCE = 2;
const SEVERITY: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

const overlaps = (f: ScoredFinding, [from, to]: [number, number]) => {
  const start = f.lineStart;
  const end = f.lineEnd ?? f.lineStart;
  return start <= to + TOLERANCE && end >= from - TOLERANCE;
};

/** Compares what the reviewer reported with the answer key of one case. */
export function scoreCase(spec: EvalSpec, found: ScoredFinding[]): CaseScore {
  const hits = (e: ExpectedIssue) => (f: ScoredFinding) => f.filePath === e.file && overlaps(f, e.lines);
  const caughtIssues = spec.expected.filter((e) => found.some(hits(e)));
  const onTarget = found.filter((f) => spec.expected.some((e) => hits(e)(f))).length;
  // on a clean change, anything above the allowed severity is a false alarm
  const limit = SEVERITY.indexOf(spec.max_severity_ok ?? 'info');
  const falseAlarms = spec.expected.length === 0 ? found.filter((f) => SEVERITY.indexOf(f.severity) > limit).length : 0;
  return {
    expected: spec.expected.length,
    caught: caughtIssues.length,
    findings: found.length,
    onTarget,
    falseAlarms,
    missed: spec.expected.filter((e) => !caughtIssues.includes(e)).map((e) => e.issue),
  };
}

/** Recall / precision as 0..1, or null when there is nothing to divide by. */
export const ratio = (num: number, den: number): number | null => (den === 0 ? null : Number((num / den).toFixed(4)));

/** Calculate F1 score from Precision and Recall. */
export function calculateF1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null || precision + recall === 0) return null;
  return Number(((2 * precision * recall) / (precision + recall)).toFixed(4));
}

/**
 * Aggregates complete quality metrics (Precision, Recall, F1, Critical/High recall,
 * FP, FN, severity and category breakdowns) across an array of eval case results.
 */
export function aggregateQualityMetrics(cases: Array<{ spec: EvalSpec; found: ScoredFinding[] }>): QualityMetrics {
  let totalExpected = 0;
  let totalCaught = 0;
  let totalFindings = 0;
  let totalOnTarget = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  const severityCounts: Record<Severity, { expected: number; caught: number }> = {
    info: { expected: 0, caught: 0 },
    low: { expected: 0, caught: 0 },
    medium: { expected: 0, caught: 0 },
    high: { expected: 0, caught: 0 },
    critical: { expected: 0, caught: 0 },
  };

  const categoryCounts: Record<string, { expected: number; caught: number }> = {};

  for (const item of cases) {
    const score = scoreCase(item.spec, item.found);
    totalExpected += score.expected;
    totalCaught += score.caught;
    totalFindings += score.findings;
    totalOnTarget += score.onTarget;
    falsePositives += Math.max(0, score.findings - score.onTarget) + score.falseAlarms;
    falseNegatives += score.expected - score.caught;

    const hits = (e: ExpectedIssue) => (f: ScoredFinding) => f.filePath === e.file && overlaps(f, e.lines);

    for (const exp of item.spec.expected) {
      const isCaught = item.found.some(hits(exp));
      const sev = exp.severity ?? 'medium';
      severityCounts[sev].expected += 1;
      if (isCaught) {
        severityCounts[sev].caught += 1;
      }

      if (exp.category) {
        if (!categoryCounts[exp.category]) {
          categoryCounts[exp.category] = { expected: 0, caught: 0 };
        }
        categoryCounts[exp.category].expected += 1;
        if (isCaught) {
          categoryCounts[exp.category].caught += 1;
        }
      }
    }
  }

  const precision = ratio(totalOnTarget, totalFindings);
  const recall = ratio(totalCaught, totalExpected);
  const f1Score = calculateF1(precision, recall);

  const critHighExp = severityCounts.critical.expected + severityCounts.high.expected;
  const critHighCaught = severityCounts.critical.caught + severityCounts.high.caught;
  const criticalHighRecall = ratio(critHighCaught, critHighExp);

  const severityBreakdown = {} as Record<Severity, SeverityMetrics>;
  for (const s of SEVERITY) {
    const exp = severityCounts[s].expected;
    const cgt = severityCounts[s].caught;
    severityBreakdown[s] = {
      expected: exp,
      caught: cgt,
      recall: ratio(cgt, exp),
    };
  }

  const categoryBreakdown: Record<string, { expected: number; caught: number; recall: number | null }> = {};
  for (const [cat, data] of Object.entries(categoryCounts)) {
    categoryBreakdown[cat] = {
      expected: data.expected,
      caught: data.caught,
      recall: ratio(data.caught, data.expected),
    };
  }

  return {
    totalExpected,
    totalCaught,
    totalFindings,
    totalOnTarget,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1Score,
    criticalHighExpected: critHighExp,
    criticalHighCaught: critHighCaught,
    criticalHighRecall,
    severityBreakdown,
    categoryBreakdown,
  };
}
