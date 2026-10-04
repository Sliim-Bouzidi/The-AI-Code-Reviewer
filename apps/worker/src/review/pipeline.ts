import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  eq, findings as findingsTable, installations, pullRequests, repoSettings, repositories, reviews,
} from '@codereview/db';
import { DEFAULT_REPO_SETTINGS } from '@codereview/shared';
import type { CandidateFinding, RepoSettings, ReviewJobData } from '@codereview/shared';
import type { Deps } from '../deps.js';
import { log } from '../deps.js';
import { downloadFiles, fetchPrDiff, postReview, repoRef } from '../github.js';
import type { RepoRef } from '../github.js';
import { retrieveContext } from './context.js';
import { parseUnifiedDiff } from './diff.js';
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
  let tmp: string | null = null;

  try {
    // ---- settings + GitHub coordinates
    let settings: RepoSettings = DEFAULT_REPO_SETTINGS;
    let gh: { ref: RepoRef; prNumber: number; headSha: string } | null = null;
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
    }

    // ---- 2. fetch + filter
    const diff = gh ? await fetchPrDiff(gh.ref, gh.prNumber) : job.diff;
    if (!diff) throw new Error('no diff to review');
    const reviewable = filterReviewable(parseUnifiedDiff(diff), settings.ignoredPaths);
    const files = reviewable.slice(0, MAX_FILES);
    log('review', 'diff parsed', { reviewId: review.id, files: files.length, skipped: reviewable.length - files.length });

    // ---- 3. parse: TODO(module 2/3) Tree-sitter extraction of changed symbols + their callers

    // ---- 4. static analysis (needs real files, so PR reviews only)
    const candidates: CandidateFinding[] = [];
    if (gh && files.length > 0) {
      tmp = await mkdtemp(join(tmpdir(), 'codereview-'));
      await downloadFiles(gh.ref, gh.headSha, files.map((f) => f.path), tmp);
      candidates.push(...(await runSemgrep(tmp)));
    }

    // ---- 5. context retrieval
    const context = await retrieveContext(deps, review.repoId, files);

    // ---- 6. LLM review, one call per file
    let tokensIn = 0;
    let tokensOut = 0;
    let provider: string | null = null;
    let model: string | null = null;
    let failedFiles = 0;
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
    }
    if (files.length > 0 && failedFiles === files.length) throw new Error('the LLM failed on every file');

    // ---- 7. validation / ranking
    const final = validateAndRank(candidates, files, settings);
    const summary = buildSummary(final, files.length - failedFiles, reviewable.length - files.length, failedFiles);

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
      const githubReviewId = await postReview(gh.ref, gh.prNumber, gh.headSha, `**AI review** — ${summary}`, final);
      if (saved.length > 0) {
        await db.update(findingsTable).set({ posted: true }).where(eq(findingsTable.reviewId, review.id));
      }
      log('review', 'posted', { reviewId: review.id, githubReviewId, comments: final.length });
    }
    log('review', 'completed', { reviewId: review.id, findings: final.length, ms: Date.now() - started });
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await db
      .update(reviews)
      .set({ status: 'failed', error: message, durationMs: Date.now() - started })
      .where(eq(reviews.id, review.id));
    throw err; // lets BullMQ retry with backoff
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}
