import { describe, expect, it } from 'vitest';
import type { ReviewWithFindings } from '@codereview/shared';
import { canExportReviewMarkdown, formatReviewMarkdown } from './review-markdown.js';

function baseReview(over: Partial<ReviewWithFindings> = {}): ReviewWithFindings {
  return {
    id: 'r1',
    repoId: 'repo1',
    prId: 'pr1',
    prNumber: 12,
    prTitle: 'Add token check',
    headSha: 'abc',
    trigger: 'webhook',
    status: 'completed',
    provider: 'gemini',
    model: 'gemini-flash',
    tokensIn: 100,
    tokensOut: 50,
    durationMs: 2500,
    summary: 'Two issues found.',
    error: null,
    createdAt: '2026-10-19T12:00:00.000Z',
    findings: [],
    ...over,
  };
}

describe('formatReviewMarkdown', () => {
  it('groups findings by file with severity and suggestion', () => {
    const md = formatReviewMarkdown({
      repoFullName: 'acme/api',
      review: baseReview({
        findings: [
          {
            id: 'f2',
            reviewId: 'r1',
            filePath: 'src/db.ts',
            lineStart: 40,
            lineEnd: 40,
            severity: 'high',
            category: 'security',
            source: 'llm',
            message: 'SQL is built by concatenating the user id.',
            suggestion: 'Use a parameterized query.',
            confidence: 0.9,
            posted: true,
            githubCommentId: 1,
          },
          {
            id: 'f1',
            reviewId: 'r1',
            filePath: 'src/auth.ts',
            lineStart: 18,
            lineEnd: 20,
            severity: 'medium',
            category: 'bug',
            source: 'semgrep',
            message: 'Token is used before the null check.',
            suggestion: null,
            confidence: 0.8,
            posted: false,
            githubCommentId: null,
          },
        ],
      }),
    });

    expect(md).toContain('# Review: #12 Add token check');
    expect(md).toContain('**Repo:** acme/api');
    expect(md).toContain('**Status:** completed');
    expect(md).toContain('**Model:** gemini-flash');
    expect(md).toContain('**Duration:** 2.5 s');
    expect(md).toContain('**Summary:** Two issues found.');
    expect(md).toContain('## Findings (2)');
    expect(md).toContain('### `src/auth.ts`');
    expect(md).toContain('### `src/db.ts`');
    expect(md).toContain('- **medium** · bug · L18-20 · semgrep');
    expect(md).toContain('- **high** · security · L40 · llm');
    expect(md).toContain('Use a parameterized query.');
  });

  it('exports a summary-only review', () => {
    const md = formatReviewMarkdown({
      review: baseReview({
        prNumber: null,
        prTitle: null,
        durationMs: 400,
        findings: [],
        summary: 'Looks fine.',
      }),
    });
    expect(md).toContain('# Review: Local diff review');
    expect(md).toContain('**Summary:** Looks fine.');
    expect(md).toContain('## Findings (0)');
    expect(md).toContain('_No findings._');
    expect(md).toContain('**Duration:** 400 ms');
  });
});

describe('canExportReviewMarkdown', () => {
  it('is true when there is a summary or findings', () => {
    expect(canExportReviewMarkdown({ summary: 'x', findings: [] })).toBe(true);
    expect(
      canExportReviewMarkdown({
        summary: null,
        findings: [
          {
            id: 'f',
            reviewId: 'r',
            filePath: 'a.ts',
            lineStart: 1,
            lineEnd: null,
            severity: 'low',
            category: 'style',
            source: 'llm',
            message: 'm',
            suggestion: null,
            confidence: null,
            posted: false,
            githubCommentId: null,
          },
        ],
      }),
    ).toBe(true);
    expect(canExportReviewMarkdown({ summary: null, findings: [] })).toBe(false);
  });
});
