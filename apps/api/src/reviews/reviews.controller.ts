import {
  BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  and, asc, count, desc, eq, findings, inArray, installations, pullRequests, repositories, reviewEvents, reviews,
} from '@codereview/db';
import type { Db } from '@codereview/db';
import { CHANNELS, DEFAULT_JOB_OPTIONS, PaginationQuerySchema, QUEUES, ReviewDiffBodySchema } from '@codereview/shared';
import type { ReviewDiffBody, ReviewJobData, ReviewStatusResponse, Stats } from '@codereview/shared';
import type { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { DB } from '../common/db.module.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ReposService } from '../repos/repos.service.js';

const reviewColumns = {
  id: reviews.id,
  repoId: reviews.repoId,
  prId: reviews.prId,
  prNumber: pullRequests.number,
  prTitle: pullRequests.title,
  headSha: reviews.headSha,
  trigger: reviews.trigger,
  status: reviews.status,
  provider: reviews.provider,
  model: reviews.model,
  tokensIn: reviews.tokensIn,
  tokensOut: reviews.tokensOut,
  durationMs: reviews.durationMs,
  summary: reviews.summary,
  error: reviews.error,
  createdAt: reviews.createdAt,
};

@Controller('api')
@UseGuards(AuthGuard)
export class ReviewsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @InjectQueue(QUEUES.REVIEW) private readonly reviewQueue: Queue<ReviewJobData>,
    private readonly repos: ReposService,
    private readonly realtime: RealtimeService,
  ) {}

  /** A review is visible to whoever requested it (MCP) or owns its repo (webhook). */
  private async load(userId: string, reviewId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(reviewId)) throw new NotFoundException('Review not found');
    const [row] = await this.db
      .select({ ...reviewColumns, requestedBy: reviews.userId })
      .from(reviews)
      .leftJoin(pullRequests, eq(pullRequests.id, reviews.prId))
      .where(eq(reviews.id, reviewId));
    if (!row) throw new NotFoundException('Review not found');
    if (row.requestedBy !== userId) {
      if (!row.repoId) throw new NotFoundException('Review not found');
      await this.repos.get(userId, row.repoId); // throws 404 when it is not the user's repo
    }
    const { requestedBy: _, ...review } = row;
    return review;
  }

  @Get('repos/:id/reviews')
  async listForRepo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodPipe(PaginationQuerySchema)) q: z.infer<typeof PaginationQuerySchema>,
  ) {
    const repo = await this.repos.get(user.id, id);
    const [total] = await this.db.select({ n: count() }).from(reviews).where(eq(reviews.repoId, repo.id));
    const items = await this.db
      .select(reviewColumns)
      .from(reviews)
      .leftJoin(pullRequests, eq(pullRequests.id, reviews.prId))
      .where(eq(reviews.repoId, repo.id))
      .orderBy(desc(reviews.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  @Get('stats')
  async stats(@CurrentUser() user: AuthUser): Promise<Stats> {
    const mine = eq(installations.userId, user.id);
    const [r] = await this.db
      .select({ n: count() })
      .from(reviews)
      .innerJoin(repositories, eq(repositories.id, reviews.repoId))
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .where(mine);
    const [f] = await this.db
      .select({ n: count() })
      .from(findings)
      .innerJoin(reviews, eq(reviews.id, findings.reviewId))
      .innerJoin(repositories, eq(repositories.id, reviews.repoId))
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .where(mine);
    const [a] = await this.db
      .select({ n: count() })
      .from(repositories)
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .where(and(mine, eq(repositories.enabled, true)));
    return { totalReviews: r?.n ?? 0, totalFindings: f?.n ?? 0, activeRepos: a?.n ?? 0 };
  }

  /** Used by the MCP `review_diff` tool: queue a review of a raw diff, then poll the status. */
  @Post('reviews/diff')
  async reviewDiff(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ReviewDiffBodySchema)) body: ReviewDiffBody) {
    const repo = body.repo ? await this.repos.findByFullName(user.id, body.repo) : null;
    const [review] = await this.db
      .insert(reviews)
      .values({ repoId: repo?.id ?? null, userId: user.id, trigger: 'mcp', status: 'queued' })
      .returning({ id: reviews.id });
    await this.reviewQueue.add('review', { reviewId: review!.id, diff: body.diff }, { ...DEFAULT_JOB_OPTIONS, jobId: review!.id });
    return { reviewId: review!.id };
  }

  /**
   * The dashboard's "Re-run review": reviews the pull request again on its latest known commit and
   * posts a fresh review on GitHub. One at a time per PR (each run costs the owner's AI quota).
   */
  @Post('reviews/:id/rerun')
  async rerun(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const review = await this.load(user.id, id); // ownership check
    if (!review.prId || !review.repoId) {
      throw new BadRequestException('Only pull request reviews can be re-run. For a local diff, run the MCP review again.');
    }
    const [pr] = await this.db.select().from(pullRequests).where(eq(pullRequests.id, review.prId));
    if (!pr) throw new NotFoundException('Pull request not found');
    const active = await this.db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.prId, pr.id), inArray(reviews.status, ['queued', 'running'])));
    if (active.length > 0) throw new ConflictException('A review of this pull request is already in progress.');

    const [next] = await this.db
      .insert(reviews)
      .values({ prId: pr.id, repoId: review.repoId, headSha: pr.headSha, trigger: 'manual', status: 'queued' })
      .returning({ id: reviews.id });
    await this.reviewQueue.add('review', { reviewId: next!.id }, { ...DEFAULT_JOB_OPTIONS, jobId: next!.id });
    return { reviewId: next!.id };
  }

  @Get('reviews/:id/status')
  async status(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ReviewStatusResponse> {
    const review = await this.load(user.id, id);
    return { status: review.status, error: review.error };
  }

  /** Real-time stream (SSE) of this review's pipeline steps and status changes. */
  @Get('reviews/:id/stream')
  async stream(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const review = await this.load(user.id, id); // ownership check before streaming anything
    return this.realtime.stream(req, res, CHANNELS.review(review.id));
  }

  /** Pipeline timeline (fetch, static analysis, LLM, ...) for the live view. */
  @Get('reviews/:id/events')
  async events(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const review = await this.load(user.id, id);
    const items = await this.db
      .select()
      .from(reviewEvents)
      .where(eq(reviewEvents.reviewId, review.id))
      .orderBy(asc(reviewEvents.createdAt));
    return { status: review.status, items };
  }

  @Get('reviews/:id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const review = await this.load(user.id, id);
    const rows = await this.db.select().from(findings).where(eq(findings.reviewId, review.id));
    return { ...review, findings: rows };
  }

  /** Not in the original contract: lets the MCP `explain_finding` tool fetch one finding. */
  @Get('findings/:id')
  async finding(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Finding not found');
    const [row] = await this.db.select().from(findings).where(eq(findings.id, id));
    if (!row) throw new NotFoundException('Finding not found');
    await this.load(user.id, row.reviewId);
    return row;
  }
}
