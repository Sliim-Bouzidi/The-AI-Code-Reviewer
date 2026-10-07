import {
  Body, Controller, Get, Inject, NotFoundException, Param, ParseIntPipe, Post, Put, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, codeChunks, cosineDistance, desc, eq, findings, getLlmEnv, pullRequests, repositories, reviews } from '@codereview/db';
import type { Db } from '@codereview/db';
import { createEmbedderFromEnv } from '@codereview/llm';
import {
  DEFAULT_JOB_OPTIONS, EnableRepoBodySchema, QUEUES, SearchBodySchema, UpdateRepoSettingsSchema,
} from '@codereview/shared';
import type { IndexJobData, RulesResponse, SearchBody, SearchResult, UpdateRepoSettings } from '@codereview/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { DB } from '../common/db.module.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ReposService } from './repos.service.js';

@Controller('api/repos')
@UseGuards(AuthGuard)
export class ReposController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @InjectQueue(QUEUES.INDEX) private readonly indexQueue: Queue<IndexJobData>,
    private readonly repos: ReposService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.repos.list(user.id);
  }

  @Post(':id/enable')
  async enable(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(EnableRepoBodySchema)) body: { enabled: boolean },
  ) {
    const repo = await this.repos.get(user.id, id);
    await this.repos.setEnabled(repo.id, body.enabled);
    return { ...repo, enabled: body.enabled };
  }

  @Post(':id/index')
  async index(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const repo = await this.repos.get(user.id, id);
    const indexProgress = 'Waiting for the worker';
    await this.db.update(repositories).set({ indexStatus: 'indexing', indexProgress }).where(eq(repositories.id, repo.id));
    await this.indexQueue.add('index', { repoId: repo.id }, DEFAULT_JOB_OPTIONS);
    return { ...repo, indexStatus: 'indexing' as const, indexProgress };
  }

  @Get(':id/settings')
  async getSettings(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.repos.settings((await this.repos.get(user.id, id)).id);
  }

  @Put(':id/settings')
  async putSettings(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(UpdateRepoSettingsSchema)) body: UpdateRepoSettings,
  ) {
    return this.repos.updateSettings((await this.repos.get(user.id, id)).id, body);
  }

  @Get(':id/rules')
  async rules(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<RulesResponse> {
    const s = await this.repos.settings((await this.repos.get(user.id, id)).id);
    return { strictness: s.strictness, customRules: s.customRules, ignoredPaths: s.ignoredPaths };
  }

  @Post(':id/search')
  async search(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(SearchBodySchema)) body: SearchBody,
  ): Promise<SearchResult[]> {
    const repo = await this.repos.get(user.id, id);
    // the user's own embedding settings (the same model their repo was indexed with)
    const embedder = createEmbedderFromEnv(await getLlmEnv(this.db, user.id));
    if (!embedder) throw new ServiceUnavailableException('Embeddings are not set up: add a Gemini key on the "AI providers" page');
    const [vector] = await embedder.embed([body.query], 'query');
    const distance = cosineDistance(codeChunks.embedding, vector!);
    const rows = await this.db
      .select({
        filePath: codeChunks.filePath,
        symbol: codeChunks.symbol,
        language: codeChunks.language,
        startLine: codeChunks.startLine,
        endLine: codeChunks.endLine,
        content: codeChunks.content,
        distance,
      })
      .from(codeChunks)
      .where(eq(codeChunks.repoId, repo.id))
      .orderBy(distance)
      .limit(body.limit);
    return rows.map(({ distance: d, ...r }) => ({ ...r, score: 1 - Number(d) }));
  }

  /** Findings of the latest completed review of a PR (what the MCP `get_pr_review` tool returns). */
  @Get(':id/prs/:number/findings')
  async prFindings(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('number', ParseIntPipe) number: number) {
    const repo = await this.repos.get(user.id, id);
    const [latest] = await this.db
      .select({ id: reviews.id, summary: reviews.summary, headSha: reviews.headSha, createdAt: reviews.createdAt })
      .from(reviews)
      .innerJoin(pullRequests, eq(pullRequests.id, reviews.prId))
      .where(and(eq(pullRequests.repoId, repo.id), eq(pullRequests.number, number), eq(reviews.status, 'completed')))
      .orderBy(desc(reviews.createdAt))
      .limit(1);
    if (!latest) throw new NotFoundException('No completed review for this PR');
    const rows = await this.db.select().from(findings).where(eq(findings.reviewId, latest.id));
    return { reviewId: latest.id, summary: latest.summary, headSha: latest.headSha, findings: rows };
  }
}
