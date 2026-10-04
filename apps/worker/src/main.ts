import { Worker } from 'bullmq';
import { createDb } from '@codereview/db';
import { createEmbedderFromEnv, createProvidersFromEnv } from '@codereview/llm';
import { loadEnv, QUEUES, redisConnection } from '@codereview/shared';
import type { IndexJobData, ReviewJobData } from '@codereview/shared';
import { log } from './deps.js';
import type { Deps } from './deps.js';
import { runIndex } from './index/indexer.js';
import { runReview } from './review/pipeline.js';

loadEnv();

const deps: Deps = {
  db: createDb(),
  llm: createProvidersFromEnv(),
  embedder: createEmbedderFromEnv(),
};
if (deps.llm.length === 0) log('worker', 'WARNING: no LLM provider configured, reviews will fail');
if (!deps.embedder) log('worker', 'WARNING: embeddings not configured, indexing/context disabled');

const connection = redisConnection();

// concurrency 1 keeps us inside free-tier rate limits; calls are also throttled in packages/llm
const workers = [
  new Worker<ReviewJobData>(QUEUES.REVIEW, (job) => runReview(deps, job.data), { connection, concurrency: 1 }),
  new Worker<IndexJobData>(QUEUES.INDEX, (job) => runIndex(deps, job.data), { connection, concurrency: 1 }),
];

for (const w of workers) {
  w.on('failed', (job, err) =>
    log('worker', 'job failed', { queue: w.name, jobId: job?.id, attempt: job?.attemptsMade, error: err.message.slice(0, 200) }),
  );
  w.on('completed', (job) => log('worker', 'job completed', { queue: w.name, jobId: job.id }));
}
log('worker', 'ready', { queues: workers.map((w) => w.name), providers: deps.llm.map((p) => `${p.name}:${p.model}`) });

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
