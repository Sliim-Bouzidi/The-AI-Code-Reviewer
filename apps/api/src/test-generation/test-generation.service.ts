import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  and,
  asc,
  count,
  desc,
  eq,
  generatedTests,
  inArray,
  pullRequests,
  testGenerations,
} from '@codereview/db';
import type { Db } from '@codereview/db';
import { DEFAULT_JOB_OPTIONS, QUEUES } from '@codereview/shared';
import type { TestGenerationJobData } from '@codereview/shared';
import { DB } from '../common/db.module.js';
import { ReposService } from '../repos/repos.service.js';
import type {
  GeneratedTestDetailDto,
  TestGenerationDetailsDto,
  TestGenerationStatusResponseDto,
  TestGenerationSummaryDto,
  TriggerTestGenerationResponseDto,
} from './dto/test-generation.dto.js';

const UUID_RE = /^[0-9a-f-]{36}$/i;

@Injectable()
export class TestGenerationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @InjectQueue(QUEUES.TEST_GEN) private readonly testGenQueue: Queue<TestGenerationJobData>,
    private readonly repos: ReposService,
  ) {}

  /** Ensures valid UUID format before DB query. */
  private validateUuid(id: string, name = 'Resource') {
    if (!UUID_RE.test(id)) {
      throw new NotFoundException(`${name} not found`);
    }
  }

  /**
   * Lists all test generation runs for a given PR.
   */
  async listForPullRequest(userId: string, prId: string): Promise<TestGenerationSummaryDto[]> {
    this.validateUuid(prId, 'Pull request');
    const [pr] = await this.db.select().from(pullRequests).where(eq(pullRequests.id, prId));
    if (!pr) throw new NotFoundException('Pull request not found');

    await this.repos.get(userId, pr.repoId); // Authorization check

    const rows = await this.db
      .select()
      .from(testGenerations)
      .where(eq(testGenerations.prId, pr.id))
      .orderBy(desc(testGenerations.createdAt));

    return rows.map((r) => ({
      id: r.id,
      prId: r.prId,
      repoId: r.repoId,
      headSha: r.headSha,
      status: r.status,
      message: r.message,
      coverageBefore: r.coverageBefore,
      coverageAfter: r.coverageAfter,
      coverageGain: r.coverageGain,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Retrieves full details of a test generation run including generated test list.
   */
  async getGenerationDetails(userId: string, generationId: string): Promise<TestGenerationDetailsDto> {
    this.validateUuid(generationId, 'Test generation');
    const [gen] = await this.db
      .select()
      .from(testGenerations)
      .where(eq(testGenerations.id, generationId));

    if (!gen) throw new NotFoundException('Test generation not found');

    await this.repos.get(userId, gen.repoId); // Authorization check

    const tests = await this.db
      .select()
      .from(generatedTests)
      .where(eq(generatedTests.generationId, gen.id))
      .orderBy(asc(generatedTests.createdAt));

    return {
      id: gen.id,
      prId: gen.prId,
      repoId: gen.repoId,
      headSha: gen.headSha,
      status: gen.status,
      message: gen.message,
      coverageBefore: gen.coverageBefore,
      coverageAfter: gen.coverageAfter,
      coverageGain: gen.coverageGain,
      createdAt: gen.createdAt,
      updatedAt: gen.updatedAt,
      generatedTests: tests.map((t) => ({
        id: t.id,
        sourceFile: t.sourceFile,
        className: t.className,
        methodName: t.methodName,
        testClassName: t.testClassName,
        status: t.status,
        compileSuccess: t.compileSuccess,
        testSuccess: t.testSuccess,
        durationMs: t.durationMs,
        postedToGithub: t.postedToGithub,
        createdAt: t.createdAt,
      })),
    };
  }

  /**
   * Retrieves status & progress metrics for an ongoing or completed test generation run.
   */
  async getGenerationStatus(userId: string, generationId: string): Promise<TestGenerationStatusResponseDto> {
    this.validateUuid(generationId, 'Test generation');
    const [gen] = await this.db
      .select()
      .from(testGenerations)
      .where(eq(testGenerations.id, generationId));

    if (!gen) throw new NotFoundException('Test generation not found');

    await this.repos.get(userId, gen.repoId);

    const [totalRow] = await this.db
      .select({ n: count() })
      .from(generatedTests)
      .where(eq(generatedTests.generationId, gen.id));

    const [completedRow] = await this.db
      .select({ n: count() })
      .from(generatedTests)
      .where(
        and(
          eq(generatedTests.generationId, gen.id),
          inArray(generatedTests.status, ['PASSED', 'FAILED', 'REJECTED', 'TIMEOUT', 'ERROR']),
        ),
      );

    const [passedRow] = await this.db
      .select({ n: count() })
      .from(generatedTests)
      .where(and(eq(generatedTests.generationId, gen.id), eq(generatedTests.status, 'PASSED')));

    const [failedRow] = await this.db
      .select({ n: count() })
      .from(generatedTests)
      .where(
        and(
          eq(generatedTests.generationId, gen.id),
          inArray(generatedTests.status, ['FAILED', 'REJECTED', 'TIMEOUT', 'ERROR']),
        ),
      );

    return {
      id: gen.id,
      status: gen.status,
      message: gen.message,
      progress: {
        total: totalRow?.n ?? 0,
        completed: completedRow?.n ?? 0,
        passed: passedRow?.n ?? 0,
        failed: failedRow?.n ?? 0,
      },
    };
  }

  /**
   * Retrieves details of a single generated test case (including source code, output and errors).
   */
  async getGeneratedTest(userId: string, testId: string): Promise<GeneratedTestDetailDto> {
    this.validateUuid(testId, 'Generated test');
    const [row] = await this.db
      .select({ test: generatedTests, gen: testGenerations })
      .from(generatedTests)
      .innerJoin(testGenerations, eq(testGenerations.id, generatedTests.generationId))
      .where(eq(generatedTests.id, testId));

    if (!row) throw new NotFoundException('Generated test not found');

    await this.repos.get(userId, row.gen.repoId); // Authorization check

    const t = row.test;
    return {
      id: t.id,
      sourceFile: t.sourceFile,
      className: t.className,
      methodName: t.methodName,
      testClassName: t.testClassName,
      testCode: t.testCode,
      rawLlmOutput: t.rawLlmOutput,
      status: t.status,
      compileSuccess: t.compileSuccess,
      compileError: t.compileError,
      testSuccess: t.testSuccess,
      executionOutput: t.executionOutput,
      executionError: t.executionError,
      durationMs: t.durationMs,
      postedToGithub: t.postedToGithub,
      createdAt: t.createdAt,
    };
  }

  /**
   * Manually triggers asynchronous automatic test generation for a PR.
   */
  async triggerForPullRequest(
    userId: string,
    prId: string,
  ): Promise<TriggerTestGenerationResponseDto> {
    this.validateUuid(prId, 'Pull request');
    const [pr] = await this.db.select().from(pullRequests).where(eq(pullRequests.id, prId));
    if (!pr) throw new NotFoundException('Pull request not found');

    await this.repos.get(userId, pr.repoId); // Authorization check

    // Check if a generation is already in progress
    const active = await this.db
      .select()
      .from(testGenerations)
      .where(
        and(
          eq(testGenerations.prId, pr.id),
          inArray(testGenerations.status, ['pending', 'generating', 'validating']),
        ),
      );

    if (active.length > 0) {
      const existing = active[0]!;
      return {
        generationId: existing.id,
        jobId: `testgen-${pr.id}-${pr.headSha}`,
        status: existing.status,
      };
    }

    const headSha = pr.headSha ?? '';
    const [gen] = await this.db
      .insert(testGenerations)
      .values({
        prId: pr.id,
        repoId: pr.repoId,
        headSha,
        status: 'pending',
        message: 'Manually triggered',
      })
      .returning();

    const jobId = `testgen-${pr.id}-${headSha}`;
    await this.testGenQueue.add(
      'test-generation',
      { prId: pr.id, repoId: pr.repoId, headSha },
      { ...DEFAULT_JOB_OPTIONS, jobId },
    );

    return {
      generationId: gen!.id,
      jobId,
      status: 'pending',
    };
  }
}
