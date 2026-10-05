import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, evalCaseResults, evalRuns, findings as findingsTable, notifications, reviews } from '@codereview/db';
import { CHANNELS } from '@codereview/shared';
import type { EvalJobData } from '@codereview/shared';
import type { Deps } from '../deps.js';
import { log } from '../deps.js';
import { publish } from '../pubsub.js';
import { runReview } from '../review/pipeline.js';
import { ratio, scoreCase } from './scoring.js';
import type { EvalSpec } from './scoring.js';

/** evals/ at the repo root (also present in the Docker image, which copies the whole repo). */
const EVALS_DIR =
  process.env.EVALS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'evals');

export function listEvalCases(dir = EVALS_DIR): { name: string; diff: string; spec: EvalSpec }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'change.patch')) && existsSync(join(dir, d.name, 'expected.json')))
    .map((d) => ({
      name: d.name,
      diff: readFileSync(join(dir, d.name, 'change.patch'), 'utf8'),
      spec: JSON.parse(readFileSync(join(dir, d.name, 'expected.json'), 'utf8')) as EvalSpec,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `eval` job: reviews every case in evals/ with the current AI settings (same pipeline as a real
 * review, run in-process and silently), scores it against the answer key and stores the results
 * for the dashboard's Quality page.
 */
export async function runEvals(deps: Deps, job: EvalJobData): Promise<void> {
  const { db } = deps;
  const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, job.runId));
  if (!run || run.status === 'completed') return;
  const started = Date.now();
  const cases = listEvalCases();
  await db.delete(evalCaseResults).where(eq(evalCaseResults.runId, run.id)); // a retry starts over
  await db
    .update(evalRuns)
    .set({ status: 'running', casesTotal: cases.length, casesDone: 0, error: null })
    .where(eq(evalRuns.id, run.id));
  if (cases.length === 0) throw new Error(`no eval cases found in ${EVALS_DIR}`);

  const totals = { expected: 0, caught: 0, findings: 0, onTarget: 0, falseAlarms: 0 };
  const modelVotes = new Map<string, number>();

  for (const [i, c] of cases.entries()) {
    const caseStart = Date.now();
    const [review] = await db
      .insert(reviews)
      .values({ userId: run.userId, trigger: 'eval', status: 'queued' })
      .returning({ id: reviews.id });
    let error: string | null = null;
    try {
      await runReview(deps, { reviewId: review!.id, diff: c.diff, silent: true });
    } catch (err) {
      error = (err as Error).message.slice(0, 300);
    }
    const [done] = await db.select().from(reviews).where(eq(reviews.id, review!.id));
    const found = error ? [] : await db.select().from(findingsTable).where(eq(findingsTable.reviewId, review!.id));
    const score = scoreCase(c.spec, found);
    if (done?.provider && done.model) {
      const key = `${done.provider}|${done.model}`;
      modelVotes.set(key, (modelVotes.get(key) ?? 0) + 1);
    }
    await db.insert(evalCaseResults).values({
      runId: run.id,
      caseName: c.name,
      description: c.spec.description ?? null,
      ...score,
      reviewId: review!.id,
      durationMs: Date.now() - caseStart,
      error,
    });
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += score[k];
    await db.update(evalRuns).set({ casesDone: i + 1, ...totals }).where(eq(evalRuns.id, run.id));
    log('eval', 'case scored', { runId: run.id, case: c.name, caught: score.caught, expected: score.expected });
  }

  // the model that answered most cases (the fallback may have taken some)
  const [top] = [...modelVotes].sort((a, b) => b[1] - a[1]);
  const [provider, model] = top ? top[0].split('|') : [null, null];
  await db
    .update(evalRuns)
    .set({ status: 'completed', provider, model, durationMs: Date.now() - started, ...totals })
    .where(eq(evalRuns.id, run.id));

  const recall = ratio(totals.caught, totals.expected);
  const precision = ratio(totals.onTarget, totals.findings);
  const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
  const body = `Recall ${pct(recall)}, precision ${pct(precision)}, ${totals.falseAlarms} false alarm(s)${model ? ` · ${model}` : ''}`;
  const [n] = await db
    .insert(notifications)
    .values({ userId: run.userId, kind: 'eval_completed', title: 'Quality evals finished', body, link: '/dashboard/quality' })
    .returning({ id: notifications.id });
  await publish(CHANNELS.user(run.userId), {
    type: 'notification', id: n!.id, kind: 'eval_completed', title: 'Quality evals finished', body, link: '/dashboard/quality',
  });
  log('eval', 'run completed', { runId: run.id, ...totals, ms: Date.now() - started });
}

/** Marks a run failed (called when the job fails for good). */
export async function failEvalRun(deps: Deps, runId: string, message: string): Promise<void> {
  const [run] = await deps.db
    .update(evalRuns)
    .set({ status: 'failed', error: message.slice(0, 300) })
    .where(eq(evalRuns.id, runId))
    .returning({ userId: evalRuns.userId });
  if (!run) return;
  await deps.db
    .insert(notifications)
    .values({ userId: run.userId, kind: 'eval_failed', title: 'Quality evals failed', body: message.slice(0, 200), link: '/dashboard/quality' });
}
