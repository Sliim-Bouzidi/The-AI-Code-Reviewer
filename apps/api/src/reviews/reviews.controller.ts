import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, count, desc, eq, findings, installations, pullRequests, repositories, reviews } from '@codereview/db';
import type { Db } from '@codereview/db';
import { DEFAULT_JOB_OPTIONS, PaginationQuerySchema, QUEUES, ReviewDiffBodySchema } from '@codereview/shared';
import type { ReviewDiffBody, ReviewJobData, ReviewStatusResponse, Stats } from '@codereview/shared';
import type { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { DB } from '../common/db.module.js';
import { ZodPipe } from '../common/zod.pipe.js';
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

  @Get('reviews/:id/status')
  async status(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ReviewStatusResponse> {
    const review = await this.load(user.id, id);
    return { status: review.status, error: review.error };
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
