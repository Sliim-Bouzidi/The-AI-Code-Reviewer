import { minimatch } from 'minimatch';
import type { DiffFile } from './diff.js';

/** Never worth an LLM call: lockfiles, generated/vendored code, binaries and assets. */
export const DEFAULT_IGNORED = [
  '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/*.lock', '**/go.sum',
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/vendor/**', '**/coverage/**',
  '**/*.min.js', '**/*.min.css', '**/*.map', '**/*.snap', '**/*.generated.*', '**/*.pb.go',
  '**/*.{png,jpg,jpeg,gif,svg,ico,webp,pdf,zip,gz,woff,woff2,ttf,eot,mp4,mp3,exe,dll,so,bin}',
];

export function isIgnoredPath(path: string, ignoredPaths: string[] = []): boolean {
  const patterns = [
    ...DEFAULT_IGNORED,
    // "docs/" in the settings UI means everything under docs
    ...ignoredPaths.map((p) => (p.endsWith('/') ? `${p}**` : p)),
  ];
  return patterns.some((p) => minimatch(path, p, { dot: true }) || minimatch(path, `**/${p}`, { dot: true }));
}

export function filterReviewable(files: DiffFile[], ignoredPaths: string[] = []): DiffFile[] {
  return files.filter(
    (f) => !f.binary && f.status !== 'deleted' && f.addedLines.size > 0 && !isIgnoredPath(f.path, ignoredPaths),
  );
}
