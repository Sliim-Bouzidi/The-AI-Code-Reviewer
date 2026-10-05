import type { Severity } from '@codereview/shared';

/** One planted issue in an eval case's expected.json (the answer key). */
export interface ExpectedIssue {
  file: string;
  lines: [number, number];
  category?: string;
  issue: string;
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
}

export interface CaseScore {
  expected: number;
  caught: number;
  findings: number;
  onTarget: number;
  falseAlarms: number;
  missed: string[];
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
export const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);
