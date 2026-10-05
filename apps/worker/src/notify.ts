import { eq, installations, notifications, repositories, reviews } from '@codereview/db';
import type { Db } from '@codereview/db';
import { CHANNELS } from '@codereview/shared';
import { log } from './deps.js';
import { publish } from './pubsub.js';

type Kind = (typeof notifications.$inferInsert)['kind'];

/** Owner of a repo = the user who connected its GitHub installation (null until connected). */
async function repoOwner(db: Db, repoId: string): Promise<{ userId: string | null; fullName: string } | null> {
  const [row] = await db
    .select({ userId: installations.userId, fullName: repositories.fullName })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .where(eq(repositories.id, repoId));
  return row ?? null;
}

async function insert(db: Db, userId: string | null, kind: Kind, title: string, body: string | null, link: string | null) {
  if (!userId) return;
  try {
    // 1. persist (source of truth, also what an offline user sees later)  2. push to open dashboards
    const [row] = await db.insert(notifications).values({ userId, kind, title, body, link }).returning({ id: notifications.id });
    await publish(CHANNELS.user(userId), { type: 'notification', id: row!.id, kind, title, body, link });
  } catch (err) {
    // a notification must never break a review or an index job
    log('notify', 'insert failed', { error: (err as Error).message.slice(0, 200) });
  }
}

/** Review finished or failed for good. Webhook reviews notify the repo owner, MCP reviews the requester. */
export async function notifyReview(db: Db, reviewId: string, outcome: 'completed' | 'failed'): Promise<void> {
  const [review] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
  if (!review) return;
  const owner = review.repoId ? await repoOwner(db, review.repoId) : null;
  const userId = review.userId ?? owner?.userId ?? null;
  const where = owner?.fullName ?? 'local changes';
  const link = `/dashboard/reviews/${review.id}`;
  await publish(CHANNELS.review(review.id), { type: 'review', reviewId: review.id, status: review.status });
  if (outcome === 'completed') {
    await insert(db, userId, 'review_completed', `Review finished: ${where}`, review.summary, link);
  } else {
    await insert(db, userId, 'review_failed', `Review failed: ${where}`, review.error, link);
  }
}

export async function notifyIndex(db: Db, repoId: string, outcome: 'ready' | 'failed', detail: string): Promise<void> {
  const owner = await repoOwner(db, repoId);
  if (!owner) return;
  const link = `/dashboard/repos`;
  if (outcome === 'ready') {
    await insert(db, owner.userId, 'index_ready', `Indexing finished: ${owner.fullName}`, detail, link);
  } else {
    await insert(db, owner.userId, 'index_failed', `Indexing failed: ${owner.fullName}`, detail, link);
  }
}
