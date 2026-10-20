import type { Finding, ReviewWithFindings, Severity } from '@codereview/shared';

/** Same order as `@codereview/shared` SEVERITY_ORDER (kept local so tests need no package runtime). */
const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const severityRank = (s: Severity) => SEVERITY_ORDER.indexOf(s);

function lineLabel(f: Finding): string {
  if (f.lineEnd != null && f.lineEnd !== f.lineStart) return `L${f.lineStart}-${f.lineEnd}`;
  return `L${f.lineStart}`;
}

function groupByFile(findings: Finding[]): Map<string, Finding[]> {
  const sorted = [...findings].sort(
    (a, b) =>
      a.filePath.localeCompare(b.filePath) ||
      severityRank(a.severity) - severityRank(b.severity) ||
      a.lineStart - b.lineStart,
  );
  const byFile = new Map<string, Finding[]>();
  for (const f of sorted) {
    byFile.set(f.filePath, [...(byFile.get(f.filePath) ?? []), f]);
  }
  return byFile;
}

function formatFinding(f: Finding): string {
  const lines = [`- **${f.severity}** · ${f.category} · ${lineLabel(f)} · ${f.source}`, `  ${f.message}`];
  if (f.suggestion) {
    lines.push('  **Suggestion:**', '  ```', ...f.suggestion.split('\n').map((l) => `  ${l}`), '  ```');
  }
  return lines.join('\n');
}

export type ReviewMarkdownInput = {
  review: ReviewWithFindings;
  repoFullName?: string | null;
};

/** Build a markdown report for a review. Always includes every finding (not the UI severity filter). */
export function formatReviewMarkdown({ review, repoFullName }: ReviewMarkdownInput): string {
  const title =
    review.prNumber != null
      ? `# Review: #${review.prNumber}${review.prTitle ? ` ${review.prTitle}` : ''}`
      : '# Review: Local diff review';

  const meta: string[] = [];
  if (repoFullName) meta.push(`**Repo:** ${repoFullName}`);
  meta.push(`**Status:** ${review.status}`);
  if (review.model) meta.push(`**Model:** ${review.model}`);
  if (review.durationMs != null) {
    const dur =
      review.durationMs < 1000 ? `${review.durationMs} ms` : `${(review.durationMs / 1000).toFixed(1)} s`;
    meta.push(`**Duration:** ${dur}`);
  }

  const parts = [title, '', ...meta];

  if (review.summary) {
    parts.push('', `**Summary:** ${review.summary}`);
  }

  if (review.findings.length === 0) {
    parts.push('', '## Findings (0)', '', '_No findings._');
    return `${parts.join('\n').trimEnd()}\n`;
  }

  parts.push('', `## Findings (${review.findings.length})`, '');

  for (const [file, items] of groupByFile(review.findings)) {
    parts.push(`### \`${file}\``, '');
    for (const f of items) {
      parts.push(formatFinding(f), '');
    }
  }

  return `${parts.join('\n').trimEnd()}\n`;
}

export function canExportReviewMarkdown(review: Pick<ReviewWithFindings, 'summary' | 'findings'>): boolean {
  return Boolean(review.summary) || review.findings.length > 0;
}
