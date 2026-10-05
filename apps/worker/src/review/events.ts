import { reviewEvents } from '@codereview/db';
import type { Db } from '@codereview/db';

export type Stage = 'fetch' | 'parse' | 'static_analysis' | 'context' | 'llm' | 'validate' | 'post';
export type StageStatus = 'running' | 'done' | 'skipped' | 'failed';

export const STAGE_LABELS: Record<Stage, string> = {
  fetch: 'Fetch diff',
  parse: 'Parse changed code (Tree-sitter)',
  static_analysis: 'Static analysis (Semgrep)',
  context: 'Codebase context',
  llm: 'LLM review',
  validate: 'Validate & rank',
  post: 'Post to GitHub',
};

/** Writes one row the dashboard shows in the live timeline. `detail` must never contain source code. */
export async function emit(
  db: Db,
  reviewId: string,
  stage: Stage,
  status: StageStatus,
  detail?: string,
  durationMs?: number,
): Promise<void> {
  try {
    await db.insert(reviewEvents).values({ reviewId, stage, status, detail: detail ?? null, durationMs: durationMs ?? null });
  } catch {
    // progress reporting must never break a review
  }
}

/** Runs `fn` as a timed stage: emits running, then done/failed with the duration. */
export async function timed<T>(
  db: Db,
  reviewId: string,
  stage: Stage,
  fn: () => Promise<T>,
  describe: (result: T) => string | undefined = () => undefined,
): Promise<T> {
  await emit(db, reviewId, stage, 'running');
  const t = Date.now();
  try {
    const result = await fn();
    await emit(db, reviewId, stage, 'done', describe(result), Date.now() - t);
    return result;
  } catch (err) {
    await emit(db, reviewId, stage, 'failed', (err as Error).message.slice(0, 200), Date.now() - t);
    throw err;
  }
}
