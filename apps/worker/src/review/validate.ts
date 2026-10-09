import { SEVERITY_ORDER } from '@codereview/shared';
import type { CandidateFinding, Severity, Strictness } from '@codereview/shared';
import type { DiffFile } from './diff.js';

const MIN_CONFIDENCE: Record<Strictness, number> = { low: 0.75, medium: 0.6, high: 0.4 };
/** How far a slightly-off line number may be moved to the nearest line of the diff. */
const SNAP_DISTANCE = 3;

const rank = (s: Severity) => SEVERITY_ORDER.indexOf(s);

function snapToDiff(line: number, valid: Set<number>): number | null {
  if (valid.has(line)) return line;
  for (let d = 1; d <= SNAP_DISTANCE; d++) {
    if (valid.has(line + d)) return line + d;
    if (valid.has(line - d)) return line - d;
  }
  return null;
}

function isNitpick(f: CandidateFinding, strictness: Strictness): boolean {
  if (strictness === 'high') return false;
  if (strictness === 'low') return f.category === 'style' || f.severity === 'info' || f.severity === 'low';
  return f.severity === 'info' || (f.category === 'style' && f.severity === 'low');
}

/**
 * Step 7 of the pipeline. Pure function:
 *  1. keep only findings whose lines really exist in the diff (GitHub rejects the rest),
 *  2. drop low-confidence findings and nitpicks according to `strictness`,
 *  3. merge duplicates (same file, overlapping lines), e.g. LLM + Semgrep on the same issue,
 *  4. rank by severity then confidence and cap at `maxComments`.
 */
export function validateAndRank(
  candidates: CandidateFinding[],
  files: DiffFile[],
  opts: { strictness: Strictness; maxComments: number },
): CandidateFinding[] {
  const byPath = new Map(files.map((f) => [f.path, f]));

  const valid: CandidateFinding[] = [];
  for (const c of candidates) {
    const file = byPath.get(c.filePath);
    if (!file) continue;
    const lineStart = snapToDiff(c.lineStart, file.commentableLines);
    if (lineStart === null) continue;
    let lineEnd = c.lineEnd;
    if (lineEnd !== null) {
      // a multi-line comment must stay inside one contiguous run of diff lines
      if (lineEnd <= lineStart) lineEnd = null;
      else for (let l = lineStart; l <= lineEnd; l++) if (!file.commentableLines.has(l)) { lineEnd = null; break; }
    }
    // Semgrep findings explicitly REJECTED by LLM analysis are dropped as false positives
    if (c.source === 'semgrep' && c.semgrepDecision === 'REJECTED') continue;
    // LLM findings must meet the confidence threshold for the current strictness
    if (c.source === 'llm' && (c.confidence ?? 0) < MIN_CONFIDENCE[opts.strictness]) continue;
    if (isNitpick(c, opts.strictness)) continue;
    valid.push({ ...c, lineStart, lineEnd });
  }

  const sorted = valid.sort(
    (a, b) => rank(a.severity) - rank(b.severity) || (b.confidence ?? 0) - (a.confidence ?? 0),
  );

  const kept: CandidateFinding[] = [];
  for (const f of sorted) {
    const dup = kept.find(
      (k) =>
        k.filePath === f.filePath &&
        f.lineStart <= (k.lineEnd ?? k.lineStart) + 1 &&
        k.lineStart <= (f.lineEnd ?? f.lineStart) + 1 &&
        (k.category === f.category || k.source !== f.source),
    );
    if (dup) {
      // keep the higher-ranked one, but do not lose a suggested fix or semgrep metadata
      dup.suggestion ??= f.suggestion;
      dup.semgrepDecision ??= f.semgrepDecision;
      dup.semgrepReason ??= f.semgrepReason;
      dup.ruleId ??= f.ruleId;
      continue;
    }
    kept.push(f);
  }
  return kept.slice(0, opts.maxComments);
}
