import type { Db } from '@codereview/db';
import type { EmbeddingProvider, LlmProvider } from '@codereview/llm';

/** Everything a job needs, passed in explicitly so stages stay testable. */
export interface Deps {
  db: Db;
  llm: LlmProvider[];
  embedder: EmbeddingProvider | null;
}

/** Logs metadata only. Never pass source code or tokens here. */
export function log(scope: string, message: string, meta: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), scope, message, ...meta }));
}
