import { createHash } from 'node:crypto';
import { extname } from 'node:path';

export interface Chunk {
  symbol: string | null;
  language: string | null;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
}

const LANGUAGES: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
  '.py': 'python', '.go': 'go', '.java': 'java', '.rb': 'ruby', '.rs': 'rust', '.php': 'php',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cs': 'csharp', '.kt': 'kotlin', '.swift': 'swift',
  '.sql': 'sql', '.sh': 'bash', '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml', '.json': 'json',
};

export const languageOf = (path: string): string | null => LANGUAGES[extname(path).toLowerCase()] ?? null;
export const hashContent = (content: string) => createHash('sha256').update(content).digest('hex');

const WINDOW = 60;
const OVERLAP = 10;

/**
 * Splits a file into chunks to embed.
 * Fixed-size line windows with overlap: the fallback used by `chunkFileBySymbol` (symbols.ts) for
 * languages without a Tree-sitter grammar, parse failures and very long functions.
 */
export function chunkFile(path: string, content: string): Chunk[] {
  const language = languageOf(path);
  const lines = content.split(/\r?\n/);
  const chunks: Chunk[] = [];
  for (let start = 0; start < lines.length; start += WINDOW - OVERLAP) {
    const slice = lines.slice(start, start + WINDOW);
    const text = slice.join('\n');
    if (text.trim().length > 0) {
      chunks.push({
        symbol: null,
        language,
        startLine: start + 1,
        endLine: start + slice.length,
        // the path is part of what is embedded: it carries a lot of meaning for search
        content: text,
        contentHash: hashContent(`${path}\n${text}`),
      });
    }
    if (start + WINDOW >= lines.length) break;
  }
  return chunks;
}
