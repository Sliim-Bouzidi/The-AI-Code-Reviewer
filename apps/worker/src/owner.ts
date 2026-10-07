import { eq, evalRuns, installations, repositories, reviews } from '@codereview/db';
import type { Db } from '@codereview/db';

/**
 * Whose AI settings pay for a job: the repository owner (the user who connected its GitHub
 * installation), or whoever asked for it (MCP review, eval run). null = unknown owner.
 */
export async function repoOwnerId(db: Db, repoId: string | null): Promise<string | null> {
  if (!repoId) return null;
  const [row] = await db
    .select({ userId: installations.userId })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .where(eq(repositories.id, repoId));
  return row?.userId ?? null;
}

export async function reviewOwnerId(db: Db, reviewId: string): Promise<string | null> {
  const [row] = await db.select({ userId: reviews.userId, repoId: reviews.repoId }).from(reviews).where(eq(reviews.id, reviewId));
  if (!row) return null;
  return row.userId ?? (await repoOwnerId(db, row.repoId));
}

export async function evalOwnerId(db: Db, runId: string): Promise<string | null> {
  const [row] = await db.select({ userId: evalRuns.userId }).from(evalRuns).where(eq(evalRuns.id, runId));
  return row?.userId ?? null;
}
