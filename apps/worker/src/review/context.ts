import { codeChunks, cosineDistance, eq } from '@codereview/db';
import type { Deps } from '../deps.js';
import { log } from '../deps.js';
import { addedText } from './diff.js';
import type { DiffFile } from './diff.js';

export interface ContextChunk {
  filePath: string;
  symbol: string | null;
  startLine: number | null;
  endLine: number | null;
  content: string;
}

const TOP_K = 5;
const MAX_CONTEXT_CHARS = 8_000;

/**
 * Step 5: for each changed file, embed its added lines and pull the most similar chunks of the
 * indexed codebase (pgvector cosine distance). Returns an empty map when the repo is not indexed.
 * TODO(module 2): also fetch the definitions of called/imported symbols once Tree-sitter parsing lands.
 */
export async function retrieveContext(
  deps: Deps,
  repoId: string | null,
  files: DiffFile[],
): Promise<Map<string, ContextChunk[]>> {
  const result = new Map<string, ContextChunk[]>();
  if (!repoId || !deps.embedder || files.length === 0) return result;
  try {
    const vectors = await deps.embedder.embed(files.map((f) => addedText(f)), 'query');
    for (const [i, file] of files.entries()) {
      const distance = cosineDistance(codeChunks.embedding, vectors[i]!);
      const rows = await deps.db
        .select({
          filePath: codeChunks.filePath,
          symbol: codeChunks.symbol,
          startLine: codeChunks.startLine,
          endLine: codeChunks.endLine,
          content: codeChunks.content,
        })
        .from(codeChunks)
        .where(eq(codeChunks.repoId, repoId))
        .orderBy(distance)
        .limit(TOP_K);
      let budget = MAX_CONTEXT_CHARS;
      const kept: ContextChunk[] = [];
      for (const row of rows) {
        if (row.content.length > budget) continue;
        budget -= row.content.length;
        kept.push(row);
      }
      result.set(file.path, kept);
    }
  } catch (err) {
    // context is a quality boost, not a requirement: review without it
    log('context', 'retrieval failed', { error: (err as Error).message });
  }
  return result;
}
