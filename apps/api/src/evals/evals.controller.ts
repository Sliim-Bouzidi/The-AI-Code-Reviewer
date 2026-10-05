import { ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, desc, eq, evalCaseResults, evalRuns, inArray } from '@codereview/db';
import type { Db } from '@codereview/db';
import { DEFAULT_JOB_OPTIONS, QUEUES } from '@codereview/shared';
import type { EvalJobData, EvalRun } from '@codereview/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { DB } from '../common/db.module.js';

type RunRow = typeof evalRuns.$inferSelect;
type CaseRow = typeof evalCaseResults.$inferSelect;

const ratio = (num: number, den: number) => (den === 0 ? null : num / den);

function toEvalRun(run: RunRow, cases: CaseRow[]): EvalRun {
  return {
    id: run.id,
    status: run.status,
    provider: run.provider,
    model: run.model,
    casesTotal: run.casesTotal,
    casesDone: run.casesDone,
    expected: run.expected,
    caught: run.caught,
    findings: run.findings,
    onTarget: run.onTarget,
    falseAlarms: run.falseAlarms,
    recall: ratio(run.caught, run.expected),
    precision: ratio(run.onTarget, run.findings),
    durationMs: run.durationMs,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    cases: cases
      .filter((c) => c.runId === run.id)
      .sort((a, b) => a.caseName.localeCompare(b.caseName))
      .map((c) => ({
        caseName: c.caseName,
        description: c.description,
        expected: c.expected,
        caught: c.caught,
        findings: c.findings,
        onTarget: c.onTarget,
        falseAlarms: c.falseAlarms,
        missed: c.missed,
        reviewId: c.reviewId,
        durationMs: c.durationMs,
        error: c.error,
      })),
  };
}

/** Quality evals: run the planted-bug cases in evals/ and read the scores (dashboard "Quality" page). */
@Controller('api/evals')
@UseGuards(AuthGuard)
export class EvalsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @InjectQueue(QUEUES.EVAL) private readonly evalQueue: Queue<EvalJobData>,
  ) {}

  /** Latest runs (newest first) with their per-case results, for the charts. */
  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<EvalRun[]> {
    const runs = await this.db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.userId, user.id))
      .orderBy(desc(evalRuns.createdAt))
      .limit(30);
    if (runs.length === 0) return [];
    const cases = await this.db.select().from(evalCaseResults).where(inArray(evalCaseResults.runId, runs.map((r) => r.id)));
    return runs.map((r) => toEvalRun(r, cases));
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<EvalRun> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Run not found');
    const [run] = await this.db.select().from(evalRuns).where(and(eq(evalRuns.id, id), eq(evalRuns.userId, user.id)));
    if (!run) throw new NotFoundException('Run not found');
    const cases = await this.db.select().from(evalCaseResults).where(eq(evalCaseResults.runId, run.id));
    return toEvalRun(run, cases);
  }

  /** Starts a run with the current AI settings. One at a time per user: each run costs AI quota. */
  @Post()
  async start(@CurrentUser() user: AuthUser): Promise<EvalRun> {
    const active = await this.db
      .select({ id: evalRuns.id })
      .from(evalRuns)
      .where(and(eq(evalRuns.userId, user.id), inArray(evalRuns.status, ['queued', 'running'])));
    if (active.length > 0) throw new ConflictException('An eval run is already in progress.');
    const [run] = await this.db.insert(evalRuns).values({ userId: user.id, status: 'queued' }).returning();
    // one attempt: a retry would re-review every case and burn quota again
    await this.evalQueue.add('eval', { runId: run!.id }, { ...DEFAULT_JOB_OPTIONS, attempts: 1, jobId: run!.id });
    return toEvalRun(run!, []);
  }
}
