import { describe, expect, it } from 'vitest';
import type { CandidateFinding } from '@codereview/shared';
import { chunkFile } from '../index/chunker.js';
import { parseUnifiedDiff, renderFileForLlm } from './diff.js';
import { filterReviewable, isIgnoredPath } from './filter.js';
import { validateAndRank } from './validate.js';

const DIFF = `diff --git a/src/auth.ts b/src/auth.ts
index 1111111..2222222 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,8 @@ export function login(user: string) {
   const a = 1;
   const b = 2;
-  return check(user);
+  const q = "SELECT * FROM users WHERE name = '" + user + "'";
+  db.query(q);
+  return true;
   // trailing
 }
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 3333333..4444444 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1,2 +1,3 @@
 a
+b
 c
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;

const finding = (over: Partial<CandidateFinding>): CandidateFinding => ({
  filePath: 'src/auth.ts', lineStart: 12, lineEnd: null, severity: 'high', category: 'security',
  source: 'llm', message: 'SQL injection', suggestion: null, confidence: 0.9, ...over,
});

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(DIFF);
  it('finds files, status and line numbers', () => {
    expect(files.map((f) => f.path)).toEqual(['src/auth.ts', 'pnpm-lock.yaml', 'src/new.ts']);
    expect(files[2]!.status).toBe('added');
    expect([...files[0]!.addedLines]).toEqual([12, 13, 14]);
    expect([...files[0]!.commentableLines]).toEqual([10, 11, 12, 13, 14, 15, 16]);
  });
  it('renders new-file line numbers for the model', () => {
    const text = renderFileForLlm(files[0]!);
    expect(text).toContain('   12 +  const q');
    expect(text).toContain('      -  return check(user);');
  });
});

describe('filter', () => {
  it('skips lockfiles, generated files and ignored paths', () => {
    expect(isIgnoredPath('pnpm-lock.yaml')).toBe(true);
    expect(isIgnoredPath('web/dist/app.js')).toBe(true);
    expect(isIgnoredPath('docs/guide.md', ['docs/'])).toBe(true);
    expect(isIgnoredPath('src/auth.ts', ['docs/'])).toBe(false);
    expect(filterReviewable(parseUnifiedDiff(DIFF)).map((f) => f.path)).toEqual(['src/auth.ts', 'src/new.ts']);
  });
});

describe('validateAndRank', () => {
  const files = parseUnifiedDiff(DIFF);
  const opts = { strictness: 'medium' as const, maxComments: 15 };

  it('drops findings outside the diff and unknown files', () => {
    const out = validateAndRank(
      [finding({}), finding({ lineStart: 200 }), finding({ filePath: 'nope.ts' })], files, opts);
    expect(out).toHaveLength(1);
  });
  it('snaps a slightly-off line onto the diff', () => {
    expect(validateAndRank([finding({ lineStart: 18 })], files, opts)[0]!.lineStart).toBe(16);
  });
  it('merges an LLM and a Semgrep finding on the same lines', () => {
    const out = validateAndRank(
      [finding({ suggestion: null }), finding({ source: 'semgrep', category: 'bug', lineStart: 13, suggestion: 'use params' })],
      files, opts);
    expect(out).toHaveLength(1);
    expect(out[0]!.suggestion).toBe('use params');
  });
  it('applies strictness, ranking and the cap', () => {
    const many = [
      finding({ lineStart: 10, severity: 'low', category: 'style' }),
      finding({ lineStart: 16, severity: 'medium', category: 'bug', confidence: 0.5 }),
      finding({ lineStart: 14, severity: 'medium', category: 'performance' }),
      finding({ lineStart: 12, severity: 'critical' }),
    ];
    expect(validateAndRank(many, files, opts).map((f) => f.severity)).toEqual(['critical', 'medium']);
    expect(validateAndRank(many, files, { strictness: 'high', maxComments: 15 })).toHaveLength(4);
    expect(validateAndRank(many, files, { strictness: 'high', maxComments: 1 })[0]!.severity).toBe('critical');
  });
});

describe('chunkFile', () => {
  it('produces overlapping windows with stable hashes', () => {
    const content = Array.from({ length: 130 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunkFile('src/a.ts', content);
    expect(chunks.map((c) => [c.startLine, c.endLine])).toEqual([[1, 60], [51, 110], [101, 130]]);
    expect(chunkFile('src/a.ts', content)[0]!.contentHash).toBe(chunks[0]!.contentHash);
    expect(chunks[0]!.language).toBe('typescript');
  });
});
