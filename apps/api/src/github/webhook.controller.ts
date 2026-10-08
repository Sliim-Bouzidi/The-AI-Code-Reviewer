import { Controller, Headers, HttpCode, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Request } from 'express';
import { eq, pullRequests, repositories, reviews, webhookDeliveries } from '@codereview/db';
import type { Db } from '@codereview/db';
import { DEFAULT_JOB_OPTIONS, QUEUES } from '@codereview/shared';
import type { IndexJobData, ReviewJobData, TestGenerationJobData } from '@codereview/shared';
import { DB } from '../common/db.module.js';
import { GithubService } from './github.service.js';

const PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);

/** Does as little as possible: verify, dedupe, write a few rows, enqueue, answer 200. */
@Controller('webhooks/github')
export class WebhookController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @InjectQueue(QUEUES.REVIEW) private readonly reviewQueue: Queue<ReviewJobData>,
    @InjectQueue(QUEUES.INDEX) private readonly indexQueue: Queue<IndexJobData>,
    @InjectQueue(QUEUES.TEST_GEN) private readonly testGenQueue: Queue<TestGenerationJobData>,
    private readonly github: GithubService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('x-github-event') event: string | undefined,
  ) {
    if (!(await this.github.verifySignature(req.rawBody, signature))) throw new UnauthorizedException('Bad signature');
    if (!deliveryId || !event) return { ok: true, ignored: 'missing headers' };

    // idempotency: GitHub redelivers on timeouts
    const fresh = await this.db
      .insert(webhookDeliveries)
      .values({ deliveryId, event })
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.deliveryId });
    if (fresh.length === 0) return { ok: true, duplicate: true };

    try {
      return await this.dispatch(event, req.body as any);
    } catch (err) {
      // forget the delivery so GitHub's "Redeliver" (or its automatic retry) is not dropped as a duplicate
      await this.db.delete(webhookDeliveries).where(eq(webhookDeliveries.deliveryId, deliveryId));
      throw err;
    }
  }

  private async dispatch(event: string, payload: any) {
    if (event === 'pull_request') return this.onPullRequest(payload);
    if (event === 'push') return this.onPush(payload);
    if (event === 'installation' || event === 'installation_repositories') {
      if (event === 'installation' && payload.action === 'deleted') {
        await this.github.removeInstallation(payload.installation.id);
      } else {
        await this.github.syncInstallation(payload.installation.id);
      }
      return { ok: true };
    }
    return { ok: true, ignored: event };
  }

  /** A push to the default branch of an already indexed repo: re-index only the files it touched. */
  private async onPush(payload: any) {
    const [repo] = await this.db.select().from(repositories).where(eq(repositories.githubRepoId, payload.repository.id));
    if (!repo || !repo.enabled || repo.indexStatus !== 'ready') return { ok: true, ignored: 'repo not indexed' };
    if (payload.ref !== `refs/heads/${repo.defaultBranch}` || payload.deleted) return { ok: true, ignored: 'not the default branch' };

    const changed = new Set<string>();
    const removed = new Set<string>();
    for (const c of payload.commits ?? []) {
      for (const p of [...(c.added ?? []), ...(c.modified ?? [])]) {
        changed.add(p);
        removed.delete(p);
      }
      for (const p of c.removed ?? []) {
        removed.add(p);
        changed.delete(p);
      }
    }
    if (changed.size === 0 && removed.size === 0) return { ok: true, ignored: 'no file changes' };
    await this.indexQueue.add(
      'index',
      { repoId: repo.id, paths: [...changed], removed: [...removed] },
      { ...DEFAULT_JOB_OPTIONS, jobId: `index-${repo.id}-${payload.after}` },
    );
    return { ok: true, queued: 'incremental index', files: changed.size + removed.size };
  }

  private async onPullRequest(payload: any) {
    const pr = payload.pull_request;
    const [repo] = await this.db.select().from(repositories).where(eq(repositories.githubRepoId, payload.repository.id));
    if (!repo) return { ok: true, ignored: 'unknown repo' };

    const status = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open';
    const values = { title: pr.title, author: pr.user?.login, headSha: pr.head.sha, baseSha: pr.base.sha, status } as const;
    const [prRow] = await this.db
      .insert(pullRequests)
      .values({ repoId: repo.id, number: pr.number, ...values })
      .onConflictDoUpdate({ target: [pullRequests.repoId, pullRequests.number], set: values })
      .returning();

    if (!repo.enabled || !PR_ACTIONS.has(payload.action) || pr.draft) return { ok: true, queued: false };

    const [review] = await this.db
      .insert(reviews)
      .values({ prId: prRow!.id, repoId: repo.id, headSha: pr.head.sha, trigger: 'webhook', status: 'queued' })
      .returning({ id: reviews.id });
    await this.reviewQueue.add('review', { reviewId: review!.id }, { ...DEFAULT_JOB_OPTIONS, jobId: review!.id });
    await this.testGenQueue.add(
      'test-generation',
      { prId: prRow!.id, repoId: repo.id, headSha: pr.head.sha },
      { ...DEFAULT_JOB_OPTIONS, jobId: `testgen-${prRow!.id}-${pr.head.sha}` },
    );
    return { ok: true, queued: true, reviewId: review!.id };
  }
}
