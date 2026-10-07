import { Worker } from 'bullmq';
import { createDb, eq, getLlmEnv, LLM_SETTING_ENV, repositories, reviews } from '@codereview/db';
import { createEmbedderFromEnv, createProvidersFromEnv } from '@codereview/llm';
import { loadEnv, QUEUES, redisConnection } from '@codereview/shared';
import type { EvalJobData, IndexJobData, ReviewJobData } from '@codereview/shared';
import { log } from './deps.js';
import type { Deps } from './deps.js';
import { failEvalRun, runEvals } from './eval/run-evals.js';
import { initGithub } from './github.js';
import { runIndex } from './index/indexer.js';
import { notifyIndex, notifyReview } from './notify.js';
import { evalOwnerId, repoOwnerId, reviewOwnerId } from './owner.js';
import { runReview } from './review/pipeline.js';

loadEnv();

const db = createDb();
initGithub(db);
const connection = redisConnection();

/**
 * Each user brings their own AI keys and models ("AI providers" page), so every job runs with the
 * settings of the user it belongs to (see owner.ts), read fresh before the job (DB values over the env
 * defaults). Providers are cached per distinct configuration, which keeps each provider's throttle
 * state between jobs of the same user.
 */
const providerCache = new Map<string, Pick<Deps, 'llm' | 'embedder'>>();
async function depsFor(userId: string | null): Promise<Deps> {
  const env = await getLlmEnv(db, userId);
  const signature = JSON.stringify(Object.values(LLM_SETTING_ENV).map((name) => env[name] ?? ''));
  let providers = providerCache.get(signature);
  if (!providers) {
    providers = { llm: createProvidersFromEnv(env), embedder: createEmbedderFromEnv(env) };
    if (providerCache.size > 50) providerCache.clear(); // a handful of users: never grows large
    providerCache.set(signature, providers);
    log('worker', 'providers built', {
      providers: providers.llm.map((p) => `${p.name}:${p.model}`),
      embeddings: providers.embedder?.model ?? null,
    });
  }
  return { db, ...providers };
}
const deps: Deps = { db, llm: [], embedder: null }; // for failure handling only (no AI calls)

// concurrency 1 keeps us inside free-tier rate limits; calls are also throttled in packages/llm
const workers = [
  new Worker<ReviewJobData>(
    QUEUES.REVIEW,
    async (job) => runReview(await depsFor(await reviewOwnerId(db, job.data.reviewId)), job.data),
    { connection, concurrency: 1 },
  ),
  new Worker<IndexJobData>(
    QUEUES.INDEX,
    async (job) => runIndex(await depsFor(await repoOwnerId(db, job.data.repoId)), job.data),
    { connection, concurrency: 1 },
  ),
  // quality evals: a run reviews every case in evals/ one after another (long job, generous lock)
  new Worker<EvalJobData>(
    QUEUES.EVAL,
    async (job) => runEvals(await depsFor(await evalOwnerId(db, job.data.runId)), job.data),
    { connection, concurrency: 1, lockDuration: 10 * 60_000 },
  ),
];

for (const w of workers) {
  w.on('failed', (job, err) => {
    log('worker', 'job failed', { queue: w.name, jobId: job?.id, attempt: job?.attemptsMade, error: err.message.slice(0, 200) });
    if (!job) return;
    const stalled = /stalled/i.test(err.message);
    // no retry left: either all attempts are used, or it stalled (BullMQ does not retry those again)
    const final = stalled || job.attemptsMade >= (job.opts.attempts ?? 1);
    void (async () => {
      if (w.name === QUEUES.EVAL) {
        if (final) await failEvalRun(deps, (job.data as EvalJobData).runId, err.message);
      } else if (w.name === QUEUES.INDEX) {
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
log('worker', 'ready', { queues: workers.map((w) => w.name) });

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
