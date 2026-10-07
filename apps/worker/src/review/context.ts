import { and, codeChunks, cosineDistance, eq, inArray, ne, repositories } from '@codereview/db';
import { embedderId } from '@codereview/llm';
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
 * It also adds the definitions of the symbols the changed code calls (found by Tree-sitter), matched
 * by name against the indexed chunks.
 */
export async function retrieveContext(
  deps: Deps,
  repoId: string | null,
  files: DiffFile[],
  called: Map<string, string[]> = new Map(),
): Promise<Map<string, ContextChunk[]>> {
  const result = new Map<string, ContextChunk[]>();
  if (!repoId || !deps.embedder || files.length === 0) return result;
  // an index built with another embedding model cannot be searched with this one (re-index needed)
  const [repo] = await deps.db.select({ model: repositories.embeddingModel }).from(repositories).where(eq(repositories.id, repoId));
  if (repo?.model && repo.model !== embedderId(deps.embedder)) return result;
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
      // definitions of called symbols, defined elsewhere in the repo
      const names = called.get(file.path) ?? [];
      const definitions = names.length
        ? await deps.db
            .select({
              filePath: codeChunks.filePath,
              symbol: codeChunks.symbol,
              startLine: codeChunks.startLine,
              endLine: codeChunks.endLine,
              content: codeChunks.content,
            })
            .from(codeChunks)
            .where(and(eq(codeChunks.repoId, repoId), inArray(codeChunks.symbol, names), ne(codeChunks.filePath, file.path)))
            .limit(TOP_K)
        : [];
      let budget = MAX_CONTEXT_CHARS;
      const kept: ContextChunk[] = [];
      for (const row of [...definitions, ...rows]) {
        if (kept.some((k) => k.filePath === row.filePath && k.startLine === row.startLine)) continue;
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
