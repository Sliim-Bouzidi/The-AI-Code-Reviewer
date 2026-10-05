import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  eq, findings as findingsTable, installations, pullRequests, repoSettings, repositories, reviewEvents, reviews,
} from '@codereview/db';
import { CHANNELS, DEFAULT_REPO_SETTINGS } from '@codereview/shared';
import type { CandidateFinding, RepoSettings, ReviewJobData } from '@codereview/shared';
import type { Deps } from '../deps.js';
import { log } from '../deps.js';
import { changedSymbols, parseFile } from '../index/symbols.js';
import { notifyReview } from '../notify.js';
import { publish } from '../pubsub.js';
import { downloadFiles, fetchPrDiff, postReview, reactToPr, repoRef, startCheckRun, updateCheckRun } from '../github.js';
import type { RepoRef } from '../github.js';
import { retrieveContext } from './context.js';
import { parseUnifiedDiff } from './diff.js';
import { emit, STAGE_LABELS, timed } from './events.js';
import type { Stage } from './events.js';
import { filterReviewable } from './filter.js';
import { reviewFile } from './llm-review.js';
import { runSemgrep } from './semgrep.js';
import { validateAndRank } from './validate.js';

/** Free-tier budget: at most this many files get an LLM call per review. */
const MAX_FILES = 15;

export function buildSummary(findings: CandidateFinding[], reviewedFiles: number, skippedFiles: number, failedFiles: number): string {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  const breakdown = [...counts].map(([s, n]) => `${n} ${s}`).join(', ');
  let text =
    findings.length === 0
      ? `Reviewed ${reviewedFiles} file(s): no issues found.`
      : `Reviewed ${reviewedFiles} file(s): ${findings.length} finding(s) (${breakdown}).`;
  if (skippedFiles > 0) text += ` ${skippedFiles} file(s) were over the review limit and not analysed.`;
  if (failedFiles > 0) text += ` ${failedFiles} file(s) could not be analysed by the model.`;
  return text;
}

/** Runs the whole review for one job. Idempotent: a retry replaces the previous attempt's findings. */
export async function runReview(deps: Deps, job: ReviewJobData): Promise<void> {
  const { db } = deps;
  const started = Date.now();
  const [review] = await db.select().from(reviews).where(eq(reviews.id, job.reviewId));
  if (!review) return log('review', 'review row missing', { reviewId: job.reviewId });
  if (review.status === 'completed') return; // redelivered job

  await db.update(reviews).set({ status: 'running', error: null }).where(eq(reviews.id, review.id));
  await db.delete(reviewEvents).where(eq(reviewEvents.reviewId, review.id)); // a retry starts the timeline over
  const tmp: { dir: string | null } = { dir: null }; // an object, because it is assigned inside a callback
  let gh: { ref: RepoRef; prNumber: number; headSha: string } | null = null;
  let checkRunId: number | null = null;

  // checklist shown in the GitHub check run, updated as stages finish
  const done: string[] = [];
  const progress = async (stage: Stage, note?: string) => {
    done.push(`- ✅ ${STAGE_LABELS[stage]}${note ? ` — ${note}` : ''}`);
    if (gh && checkRunId) await updateCheckRun(gh.ref, checkRunId, { progress: done.join('\n') });
  };

  try {
    // ---- settings + GitHub coordinates
    let settings: RepoSettings = DEFAULT_REPO_SETTINGS;
    if (review.repoId) {
      const [s] = await db.select().from(repoSettings).where(eq(repoSettings.repoId, review.repoId));
      if (s) settings = s;
    }
    if (review.trigger === 'webhook' && review.prId) {
      const [row] = await db
        .select({ pr: pullRequests, repo: repositories, inst: installations })
        .from(pullRequests)
        .innerJoin(repositories, eq(repositories.id, pullRequests.repoId))
        .innerJoin(installations, eq(installations.id, repositories.installationId))
        .where(eq(pullRequests.id, review.prId));
      if (!row) throw new Error('pull request not found');
      gh = {
        ref: repoRef(row.inst.githubInstallationId, row.repo.fullName),
        prNumber: row.pr.number,
        headSha: review.headSha ?? row.pr.headSha ?? '',
      };
      // make the agent visible on the PR straight away
      await reactToPr(gh.ref, gh.prNumber);
      checkRunId = await startCheckRun(gh.ref, gh.headSha);
      if (checkRunId) await db.update(reviews).set({ checkRunId }).where(eq(reviews.id, review.id));
    }

    // ---- 2. fetch + filter
    const { files, reviewable } = await timed(
      db,
      review.id,
      'fetch',
      async () => {
        const diff = gh ? await fetchPrDiff(gh.ref, gh.prNumber) : job.diff;
        if (!diff) throw new Error('no diff to review');
        const reviewable = filterReviewable(parseUnifiedDiff(diff), settings.ignoredPaths);
        return { files: reviewable.slice(0, MAX_FILES), reviewable };
      },
      (r) => `${r.files.length} file(s) to review${r.reviewable.length > r.files.length ? `, ${r.reviewable.length - r.files.length} over the limit` : ''}`,
    );
    log('review', 'diff parsed', { reviewId: review.id, files: files.length, skipped: reviewable.length - files.length });
    await progress('fetch', `${files.length} file(s)`);

    // ---- 3. parse: Tree-sitter finds the functions/classes the diff touches and what they call.
    // Needs the real files, so only PR reviews (a local diff has no file contents).
    const called = new Map<string, string[]>();
    const changedNames = new Map<string, string[]>();
    if (gh && files.length > 0) {
      await timed(
        db,
        review.id,
        'parse',
        async () => {
          const dir = await mkdtemp(join(tmpdir(), 'codereview-'));
          tmp.dir = dir;
          await downloadFiles(gh!.ref, gh!.headSha, files.map((f) => f.path), dir);
          for (const file of files) {
            try {
              const parsed = await parseFile(file.path, await readFile(join(dir, file.path), 'utf8'));
              if (!parsed) continue;
              const touched = changedSymbols(parsed, file.addedLines);
              changedNames.set(file.path, touched.map((s) => s.name));
              called.set(file.path, [...new Set(touched.flatMap((s) => s.calls))]);
            } catch {
              // file could not be downloaded or parsed: the review just has less context
            }
          }
        },
        () => {
          const symbols = [...changedNames.values()].reduce((n, s) => n + s.length, 0);
          const calls = [...called.values()].reduce((n, c) => n + c.length, 0);
          return `${symbols} changed symbol(s), ${calls} call(s) traced`;
        },
      );
      await progress('parse', `${[...changedNames.values()].reduce((n, s) => n + s.length, 0)} changed symbol(s)`);
    } else {
      await emit(db, review.id, 'parse', 'skipped', 'local diff: no file contents to parse');
    }

    // ---- 4. static analysis (needs real files, so PR reviews only)
    const candidates: CandidateFinding[] = [];
    if (tmp.dir) {
      const dir = tmp.dir;
      const found = await timed(db, review.id, 'static_analysis', () => runSemgrep(dir), (r) => `${r.length} finding(s)`);
      candidates.push(...found);
      await progress('static_analysis', `${found.length} finding(s)`);
    } else {
      await emit(db, review.id, 'static_analysis', 'skipped', 'local diff or no reviewable files');
    }

    // ---- 5. context retrieval: similar code + definitions of the symbols the change calls
    const context = await timed(
      db,
      review.id,
      'context',
      () => retrieveContext(deps, review.repoId, files, called),
      (c) => `${[...c.values()].reduce((n, chunks) => n + chunks.length, 0)} related chunk(s) from the index`,
    );
    await progress('context');

    // ---- 6. LLM review, one call per file
    let tokensIn = 0;
    let tokensOut = 0;
    let provider: string | null = null;
    let model: string | null = null;
    let failedFiles = 0;
    await emit(db, review.id, 'llm', 'running', `0/${files.length} files`);
    const llmStart = Date.now();
    let reviewedCount = 0;
    for (const file of files) {
      try {
        const res = await reviewFile(deps.llm, file, context.get(file.path) ?? [], settings.customRules, settings.strictness);
        candidates.push(...res.findings);
        tokensIn += res.tokensIn;
        tokensOut += res.tokensOut;
        provider = res.provider;
        model = res.model;
      } catch (err) {
        failedFiles++;
        log('review', 'file review failed', { reviewId: review.id, error: (err as Error).message.slice(0, 200) });
      }
      reviewedCount++;
      await emit(db, review.id, 'llm', 'running', `${reviewedCount}/${files.length} files — ${file.path}`);
    }
    if (files.length > 0 && failedFiles === files.length) {
      await emit(db, review.id, 'llm', 'failed', 'the LLM failed on every file', Date.now() - llmStart);
      throw new Error('the LLM failed on every file');
    }
    await emit(
      db, review.id, 'llm', 'done',
      `${files.length - failedFiles}/${files.length} files, ${tokensIn + tokensOut} tokens${model ? ` (${provider}:${model})` : ''}`,
      Date.now() - llmStart,
    );
    await progress('llm', `${files.length - failedFiles}/${files.length} files`);

    // ---- 7. validation / ranking
    const final = await timed(
      db,
      review.id,
      'validate',
      async () => validateAndRank(candidates, files, settings),
      (r) => `${candidates.length} candidate(s) → ${r.length} kept`,
    );
    const summary = buildSummary(final, files.length - failedFiles, reviewable.length - files.length, failedFiles);
    await progress('validate', `${final.length} kept`);

    // ---- 8. persist
    const saved = await db.transaction(async (tx) => {
      await tx.delete(findingsTable).where(eq(findingsTable.reviewId, review.id));
      const rows = final.length
        ? await tx.insert(findingsTable).values(final.map((f) => ({ ...f, reviewId: review.id }))).returning({ id: findingsTable.id })
        : [];
      await tx
        .update(reviews)
        .set({ status: 'completed', summary, provider, model, tokensIn, tokensOut, durationMs: Date.now() - started })
        .where(eq(reviews.id, review.id));
      return rows;
    });

    // ---- 9. post to GitHub
    if (gh) {
      const target = gh;
      const githubReviewId = await timed(
        db,
        review.id,
        'post',
        () => postReview(target.ref, target.prNumber, target.headSha, `**AI review** — ${summary}`, final),
        () => `${final.length} inline comment(s)`,
      );
      if (saved.length > 0) {
        await db.update(findingsTable).set({ posted: true }).where(eq(findingsTable.reviewId, review.id));
      }
      if (checkRunId) {
        await updateCheckRun(target.ref, checkRunId, {
          conclusion: final.length > 0 ? 'neutral' : 'success',
          title: final.length > 0 ? `${final.length} issue(s) found` : 'No issues found',
          summary: `${summary}\n\n${done.join('\n')}`,
        });
      }
      log('review', 'posted', { reviewId: review.id, githubReviewId, comments: final.length });
    } else {
      await emit(db, review.id, 'post', 'skipped', 'local review, nothing to post');
    }
    if (!job.silent) await notifyReview(db, review.id, 'completed'); // eval reviews stay quiet
    log('review', 'completed', { reviewId: review.id, findings: final.length, ms: Date.now() - started });
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await db
      .update(reviews)
      .set({ status: 'failed', error: message, durationMs: Date.now() - started })
      .where(eq(reviews.id, review.id));
    await publish(CHANNELS.review(review.id), { type: 'review', reviewId: review.id, status: 'failed' });
    if (gh && checkRunId) {
      await updateCheckRun(gh.ref, checkRunId, {
        conclusion: 'neutral',
        title: 'Review failed',
        summary: `The AI reviewer hit an error and will retry: ${message}`,
      });
    }
    throw err; // lets BullMQ retry with backoff
  } finally {
    if (tmp.dir) await rm(tmp.dir, { recursive: true, force: true });
  }
}
