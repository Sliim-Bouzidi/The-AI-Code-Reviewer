import type { LlmProvider } from '@codereview/llm';
import type { SemgrepAlert } from '@codereview/shared';
import type { DiffFile, DiffHunk } from './diff.js';
import type { ParsedFile, Symbol } from '../index/symbols.js';
import { parseFile } from '../index/symbols.js';

export interface TargetedContextOptions {
  /** Full source code of the file if downloaded/available */
  fileContent?: string | null;
  /** Parsed symbols from Tree-sitter if available */
  parsed?: ParsedFile | null;
  /** Line numbers flagged by static analysis/Semgrep */
  findingLines?: number[];
  /** Semgrep alerts relevant to this file */
  semgrepAlerts?: SemgrepAlert[];
  /** Maximum context size in characters (default: 4000) */
  maxChars?: number;
  /** Surrounding line padding when extracting windows around changed lines (default: 5) */
  linePadding?: number;
  /** Powerful LLM provider tier for escalation (deep verification) */
  powerfulLlm?: LlmProvider[];
  /** Optional policy overrides for escalation */
  escalationPolicy?: {
    escalateOnUncertain?: boolean;
    escalateOnHighSeverity?: boolean;
    escalateOnInvalidResponse?: boolean;
    escalateOnLowConfidence?: boolean;
  };
}

export interface TargetedContextResult {
  formattedText: string;
  chunkCount: number;
  totalLinesIncluded: number;
  estimatedTokens: number;
}

/**
 * Estimates token count based on standard character-to-token ratio (~4 chars per token).
 * Note: This is an estimated measurement, not a vendor-specific token counter.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface ExtractedRange {
  startLine: number;
  endLine: number;
  symbols: string[];
}

/**
 * Extracts targeted context for LLM review instead of dumping full diffs or files.
 * Uses Tree-sitter symbol boundaries when file content is available, falls back to targeted hunk windows.
 */
export async function extractTargetedContext(
  file: DiffFile,
  options: TargetedContextOptions = {},
): Promise<TargetedContextResult> {
  const maxChars = options.maxChars ?? 4000;
  const linePadding = options.linePadding ?? 5;
  let fileContent = options.fileContent ?? null;
  let parsed = options.parsed ?? null;
  const findingLines = [...(options.findingLines ?? [])];
  if (options.semgrepAlerts) {
    for (const a of options.semgrepAlerts) {
      if (a.filePath === file.path && !findingLines.includes(a.lineStart)) {
        findingLines.push(a.lineStart);
      }
    }
  }

  // Attempt on-the-fly symbol parsing if file content is provided without parsed AST
  if (fileContent && !parsed) {
    try {
      parsed = await parseFile(file.path, fileContent);
    } catch {
      parsed = null;
    }
  }

  let formattedText = '';
  let chunkCount = 0;
  let totalLinesIncluded = 0;

  if (fileContent && fileContent.trim().length > 0) {
    const fileLines = fileContent.split(/\r?\n/);
    const result = buildFromFullContent(file, fileLines, parsed, findingLines, linePadding, maxChars);
    formattedText = result.formattedText;
    chunkCount = result.chunkCount;
    totalLinesIncluded = result.totalLinesIncluded;
  } else {
    const result = buildFromHunks(file, findingLines, linePadding, maxChars);
    formattedText = result.formattedText;
    chunkCount = result.chunkCount;
    totalLinesIncluded = result.totalLinesIncluded;
  }

  // Ensure strict context size budget
  if (formattedText.length > maxChars) {
    const truncationNotice = `\n... (context truncated to fit ${maxChars} character limit)`;
    const budget = maxChars - truncationNotice.length;
    formattedText = formattedText.slice(0, Math.max(0, budget)) + truncationNotice;
  }

  return {
    formattedText,
    chunkCount,
    totalLinesIncluded,
    estimatedTokens: estimateTokens(formattedText),
  };
}

/**
 * Synchronous wrapper around extractTargetedContext for rendering in buildPrompt.
 */
export function renderTargetedContextForLlm(
  file: DiffFile,
  options: TargetedContextOptions = {},
): string {
  const maxChars = options.maxChars ?? 4000;
  const linePadding = options.linePadding ?? 5;
  const fileContent = options.fileContent ?? null;
  const parsed = options.parsed ?? null;
  const findingLines = [...(options.findingLines ?? [])];
  if (options.semgrepAlerts) {
    for (const a of options.semgrepAlerts) {
      if (a.filePath === file.path && !findingLines.includes(a.lineStart)) {
        findingLines.push(a.lineStart);
      }
    }
  }

  let formattedText = '';

  if (fileContent && fileContent.trim().length > 0) {
    const fileLines = fileContent.split(/\r?\n/);
    formattedText = buildFromFullContent(file, fileLines, parsed, findingLines, linePadding, maxChars).formattedText;
  } else {
    formattedText = buildFromHunks(file, findingLines, linePadding, maxChars).formattedText;
  }

  if (formattedText.length > maxChars) {
    const truncationNotice = `\n... (context truncated to fit ${maxChars} character limit)`;
    const budget = maxChars - truncationNotice.length;
    formattedText = formattedText.slice(0, Math.max(0, budget)) + truncationNotice;
  }

  return formattedText;
}

function buildFromFullContent(
  file: DiffFile,
  fileLines: string[],
  parsed: ParsedFile | null,
  findingLines: number[],
  linePadding: number,
  maxChars: number,
): { formattedText: string; chunkCount: number; totalLinesIncluded: number } {
  const totalLines = fileLines.length;

  // 1. Map deleted lines from diff hunks to new-file line numbers
  const deletedLinesMap = new Map<number, string[]>();
  for (const hunk of file.hunks) {
    let n = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.startsWith('-')) {
        const list = deletedLinesMap.get(n) ?? [];
        list.push(line.slice(1));
        deletedLinesMap.set(n, list);
      } else if (line.startsWith('+') || line.startsWith(' ')) {
        n++;
      }
    }
  }

  // 2. Identify all concerned line numbers
  const concernedLines = new Set<number>();
  for (const line of file.addedLines) concernedLines.add(line);
  for (const line of findingLines) concernedLines.add(line);
  for (const [line] of deletedLinesMap) concernedLines.add(line);

  // If no lines touched (e.g. empty diff), fallback to initial window
  if (concernedLines.size === 0) {
    for (let i = 1; i <= Math.min(totalLines, linePadding * 2); i++) {
      concernedLines.add(i);
    }
  }

  // 3. Find AST symbols containing concerned lines
  const rawRanges: ExtractedRange[] = [];
  const symbols = parsed?.symbols ?? [];

  for (const line of concernedLines) {
    // Find matching symbols for line
    const matching = symbols.filter((s) => s.startLine <= line && line <= s.endLine);
    if (matching.length > 0) {
      // Pick innermost symbol (smallest span)
      matching.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
      const s = matching[0]!;
      rawRanges.push({
        startLine: Math.max(1, s.startLine),
        endLine: Math.min(totalLines, s.endLine),
        symbols: [s.name],
      });
    } else {
      // No symbol: extract window around concerned line
      rawRanges.push({
        startLine: Math.max(1, line - linePadding),
        endLine: Math.min(totalLines, line + linePadding),
        symbols: [],
      });
    }
  }

  // 4. Merge overlapping ranges
  rawRanges.sort((a, b) => a.startLine - b.startLine);
  const mergedRanges: ExtractedRange[] = [];

  for (const range of rawRanges) {
    if (mergedRanges.length === 0) {
      mergedRanges.push({ ...range });
      continue;
    }
    const prev = mergedRanges[mergedRanges.length - 1]!;
    // Merge if overlapping or within padding distance
    if (range.startLine <= prev.endLine + linePadding) {
      prev.endLine = Math.max(prev.endLine, range.endLine);
      for (const sym of range.symbols) {
        if (!prev.symbols.includes(sym)) prev.symbols.push(sym);
      }
    } else {
      mergedRanges.push({ ...range });
    }
  }

  // 5. Format snippets
  const snippetBlocks: string[] = [];
  let totalLinesIncluded = 0;

  for (const range of mergedRanges) {
    const linesOut: string[] = [];
    const symLabel = range.symbols.length > 0 ? `, symbol: ${range.symbols.join(', ')}` : '';
    linesOut.push(`--- ${file.path}:${range.startLine}-${range.endLine}${symLabel} ---`);

    for (let l = range.startLine; l <= range.endLine; l++) {
      totalLinesIncluded++;
      // Output any deleted lines mapped before this line
      const deleted = deletedLinesMap.get(l);
      if (deleted) {
        for (const delLine of deleted) {
          linesOut.push(`      - ${delLine}`);
        }
      }

      const content = fileLines[l - 1] ?? '';
      if (file.addedLines.has(l)) {
        linesOut.push(`${String(l).padStart(5)} + ${content}`);
      } else {
        linesOut.push(`${String(l).padStart(5)}   ${content}`);
      }
    }

    // Output deleted lines at the end of file if mapped to totalLines + 1
    const endDeleted = deletedLinesMap.get(range.endLine + 1);
    if (endDeleted && range.endLine === totalLines) {
      for (const delLine of endDeleted) {
        linesOut.push(`      - ${delLine}`);
      }
    }

    snippetBlocks.push(linesOut.join('\n'));
  }

  const formattedText = snippetBlocks.join('\n\n');
  return { formattedText, chunkCount: mergedRanges.length, totalLinesIncluded };
}

function buildFromHunks(
  file: DiffFile,
  findingLines: number[],
  linePadding: number,
  maxChars: number,
): { formattedText: string; chunkCount: number; totalLinesIncluded: number } {
  const blocks: string[] = [];
  let totalLinesIncluded = 0;

  for (const hunk of file.hunks) {
    const linesOut: string[] = [hunk.header];
    let n = hunk.newStart;

    for (const line of hunk.lines) {
      totalLinesIncluded++;
      if (line.startsWith('-')) {
        linesOut.push(`      ${line}`);
      } else {
        linesOut.push(`${String(n++).padStart(5)} ${line}`);
      }
    }
    blocks.push(linesOut.join('\n'));
  }

  const formattedText = blocks.join('\n\n');
  return { formattedText, chunkCount: file.hunks.length, totalLinesIncluded };
}
