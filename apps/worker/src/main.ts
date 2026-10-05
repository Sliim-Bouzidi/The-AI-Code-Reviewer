import { Worker } from 'bullmq';
import { createDb, eq, repositories, reviews } from '@codereview/db';
import { createEmbedderFromEnv, createProvidersFromEnv } from '@codereview/llm';
import { loadEnv, QUEUES, redisConnection } from '@codereview/shared';
import type { IndexJobData, ReviewJobData } from '@codereview/shared';
import { log } from './deps.js';
import type { Deps } from './deps.js';
import { initGithub } from './github.js';
import { runIndex } from './index/indexer.js';
import { notifyIndex, notifyReview } from './notify.js';
import { runReview } from './review/pipeline.js';

loadEnv();

const deps: Deps = {
  db: createDb(),
  llm: createProvidersFromEnv(),
  embedder: createEmbedderFromEnv(),
};
initGithub(deps.db);
if (deps.llm.length === 0) log('worker', 'WARNING: no LLM provider configured, reviews will fail');
if (!deps.embedder) log('worker', 'WARNING: embeddings not configured, indexing/context disabled');

const connection = redisConnection();

// concurrency 1 keeps us inside free-tier rate limits; calls are also throttled in packages/llm
const workers = [
  new Worker<ReviewJobData>(QUEUES.REVIEW, (job) => runReview(deps, job.data), { connection, concurrency: 1 }),
  new Worker<IndexJobData>(QUEUES.INDEX, (job) => runIndex(deps, job.data), { connection, concurrency: 1 }),
];

for (const w of workers) {
  w.on('failed', (job, err) => {
    log('worker', 'job failed', { queue: w.name, jobId: job?.id, attempt: job?.attemptsMade, error: err.message.slice(0, 200) });
    if (!job) return;
    const stalled = /stalled/i.test(err.message);
    // no retry left: either all attempts are used, or it stalled (BullMQ does not retry those again)
    const final = stalled || job.attemptsMade >= (job.opts.attempts ?? 1);
    void (async () => {
      if (w.name === QUEUES.INDEX) {
        const { repoId } = job.data as IndexJobData;
        // A job interrupted by a worker restart never reaches the indexer's own error handling,
        // so the repo would stay "indexing" forever with its Index button disabled. Release it here.
        if (stalled) {
          await deps.db
            .update(repositories)
            .set({ indexStatus: 'failed', indexProgress: 'Interrupted (the worker restarted). Click Index to start again.' })
            .where(eq(repositories.id, repoId));
        }
        if (final) {
          const [repo] = await deps.db.select().from(repositories).where(eq(repositories.id, repoId));
          await notifyIndex(deps.db, repoId, 'failed', repo?.indexProgress ?? err.message.slice(0, 200));
        }
      } else if (final) {
        const { reviewId } = job.data as ReviewJobData;
        if (stalled) {
          await deps.db
            .update(reviews)
            .set({ status: 'failed', error: 'Interrupted (the worker restarted).' })
            .where(eq(reviews.id, reviewId));
        }
        await notifyReview(deps.db, reviewId, 'failed');
      }
    })().catch((e) => log('worker', 'failure handling failed', { error: (e as Error).message.slice(0, 200) }));
  });
  w.on('completed', (job) => log('worker', 'job completed', { queue: w.name, jobId: job.id }));
}
log('worker', 'ready', { queues: workers.map((w) => w.name), providers: deps.llm.map((p) => `${p.name}:${p.model}`) });

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
