export interface DiffHunk {
  oldStart: number;
  newStart: number;
  header: string;
  /** Raw hunk lines, each still starting with '+', '-' or ' '. */
  lines: string[];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  binary: boolean;
  hunks: DiffHunk[];
  /** New-file line numbers that were added by this diff. */
  addedLines: Set<number>;
  /** New-file line numbers GitHub accepts an inline comment on (added + context lines). */
  commentableLines: Set<number>;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const stripPrefix = (p: string) => p.replace(/^"?[ab]\//, '').replace(/"$/, '');

/** Parses a unified git diff (`git diff` or GitHub's `.diff`) into files and hunks. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let newLine = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/);
      file = {
        path: m?.[2] ?? '',
        oldPath: null,
        status: 'modified',
        binary: false,
        hunks: [],
        addedLines: new Set(),
        commentableLines: new Set(),
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (!hunk) {
      if (line.startsWith('new file mode')) file.status = 'added';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('rename from ')) {
        file.status = 'renamed';
        file.oldPath = line.slice('rename from '.length);
      } else if (line.startsWith('rename to ')) file.path = line.slice('rename to '.length);
      else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) file.binary = true;
      else if (line.startsWith('--- ') && line !== '--- /dev/null') file.oldPath ??= stripPrefix(line.slice(4));
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null') file.path = stripPrefix(line.slice(4));
    }

    const h = line.match(HUNK_RE);
    if (h) {
      hunk = { oldStart: Number(h[1]), newStart: Number(h[2]), header: line, lines: [] };
      file.hunks.push(hunk);
      newLine = hunk.newStart;
      continue;
    }
    if (!hunk) continue;

    if (line.startsWith('+')) {
      file.addedLines.add(newLine);
      file.commentableLines.add(newLine);
      hunk.lines.push(line);
      newLine++;
    } else if (line.startsWith(' ')) {
      file.commentableLines.add(newLine);
      hunk.lines.push(line);
      newLine++;
    } else if (line.startsWith('-')) {
      hunk.lines.push(line);
    }
    // "\ No newline at end of file" and blank separators are ignored
  }
  return files.filter((f) => f.path !== '');
}

/**
 * Renders a file's hunks with explicit new-file line numbers, so the model can quote real line
 * numbers instead of counting. Removed lines get no number.
 */
export function renderFileForLlm(file: DiffFile, maxChars = 12_000): string {
  const out: string[] = [];
  for (const hunk of file.hunks) {
    out.push(hunk.header);
    let n = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.startsWith('-')) out.push(`      ${line}`);
      else out.push(`${String(n++).padStart(5)} ${line}`);
    }
  }
  const text = out.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... (diff truncated)` : text;
}

/** Only the added lines of a file, used as the retrieval query. */
export function addedText(file: DiffFile, maxChars = 4_000): string {
  return file.hunks
    .flatMap((h) => h.lines.filter((l) => l.startsWith('+')).map((l) => l.slice(1)))
    .join('\n')
    .slice(0, maxChars);
}

/**
 * Reconstructs a file's content from its diff hunks (for local diffs without a repository checkout).
 * Places lines at their newStart positions, padding line gaps with empty lines so that line numbers
 * match the diff exactly for static analysis tools (e.g. Semgrep) and AST parsers.
 */
export function reconstructFileFromDiff(file: DiffFile): string {
  if (file.status === 'deleted' || file.binary || file.hunks.length === 0) {
    return '';
  }

  const linesByNumber = new Map<number, string>();
  let maxLine = 0;

  for (const hunk of file.hunks) {
    let currentLine = hunk.newStart;
    for (const rawLine of hunk.lines) {
      if (rawLine.startsWith('-')) {
        // Deleted line from old file, not in new file
        continue;
      }
      // Added ('+') or context (' ') line
      const content = rawLine.length > 0 ? rawLine.slice(1) : '';
      linesByNumber.set(currentLine, content);
      if (currentLine > maxLine) maxLine = currentLine;
      currentLine++;
    }
  }

  if (maxLine === 0) return '';

  const fullLines: string[] = [];
  for (let i = 1; i <= maxLine; i++) {
    fullLines.push(linesByNumber.get(i) ?? '');
  }

  return fullLines.join('\n');
}

