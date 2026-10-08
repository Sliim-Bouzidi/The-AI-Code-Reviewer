import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  eq,
  generatedTests,
  installations,
  pullRequests,
  repositories,
  testGenerations,
} from '@codereview/db';
import type { TestGenerationJobData } from '@codereview/shared';
import type { Deps } from '../deps.js';
import { log } from '../deps.js';
import { downloadFiles, fetchPrDiff, repoRef } from '../github.js';
import { parseUnifiedDiff } from '../review/diff.js';
import { DockerJavaExecutor } from './docker-java-executor.js';
import { extractJavaMethodContexts } from './java-context.js';
import type { JavaMethodContext } from './java-context.js';
import { generateTestForMethod } from './test-generator.js';
import type { JavaExecutor } from './test-validator.js';
import { validateJavaTest } from './test-validator.js';

export interface TestGenerationWorkerOptions {
  executor?: JavaExecutor;
}

/**
 * Runs the automatic test generation pipeline for one PR.
 *
 * Workflow:
 *   1. Fetch PR details & git diff from GitHub
 *   2. Filter for modified Java files & extract modified methods via Tree-sitter
 *   3. For each method: generate JUnit 5 + Mockito tests with LLM
 *   4. Validate each generated test in Docker Sandbox (compile & execute)
 *   5. Persist results in PostgreSQL (test_generations and generated_tests)
 */
export async function runTestGeneration(
  deps: Deps,
  job: TestGenerationJobData,
  options: TestGenerationWorkerOptions = {},
): Promise<void> {
  const { db } = deps;
  const started = Date.now();

  log('test-gen', 'starting test generation job', { prId: job.prId, repoId: job.repoId });

  // ---- 1. Fetch PR, Repository & GitHub installation details
  const [row] = await db
    .select({ pr: pullRequests, repo: repositories, inst: installations })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repoId))
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .where(eq(pullRequests.id, job.prId));

  if (!row) {
    throw new Error(`Pull request ${job.prId} not found in database`);
  }

  const ref = repoRef(row.inst.githubInstallationId, row.repo.fullName);
  const headSha = job.headSha || row.pr.headSha || '';

  // ---- 2. Create or find active test_generations row (Idempotence)
  const [generation] = await db
    .insert(testGenerations)
    .values({
      prId: job.prId,
      repoId: job.repoId,
      headSha,
      status: 'generating',
      message: 'Processing Java files',
    })
    .returning();

  const generationId = generation!.id;

  const tmp: { dir: string | null } = { dir: null };

  try {
    // ---- 3. Fetch diff & filter for Java files
    const diff = await fetchPrDiff(ref, row.pr.number);
    if (!diff) {
      await db
        .update(testGenerations)
        .set({ status: 'completed', message: 'No diff found for PR' })
        .where(eq(testGenerations.id, generationId));
      return;
    }

    const diffFiles = parseUnifiedDiff(diff);
    const javaDiffFiles = diffFiles.filter(
      (f) => f.path.endsWith('.java') && f.status !== 'deleted',
    );

    if (javaDiffFiles.length === 0) {
      log('test-gen', 'no Java files modified', { prId: job.prId });
      await db
        .update(testGenerations)
        .set({ status: 'completed', message: 'No Java files modified in PR' })
        .where(eq(testGenerations.id, generationId));
      return;
    }

    // ---- 4. Download source files & extract Java method contexts
    const dir = await mkdtemp(join(tmpdir(), 'testgen-'));
    tmp.dir = dir;
    await downloadFiles(
      ref,
      headSha,
      javaDiffFiles.map((f) => f.path),
      dir,
    );

    const allContexts: JavaMethodContext[] = [];
    for (const file of javaDiffFiles) {
      try {
        const content = await readFile(join(dir, file.path), 'utf8');
        const res = await extractJavaMethodContexts(file, content);
        allContexts.push(...res.contexts);
      } catch (err) {
        log('test-gen', 'file extraction failed', { path: file.path, error: (err as Error).message });
      }
    }

    if (allContexts.length === 0) {
      log('test-gen', 'no Java methods modified', { prId: job.prId });
      await db
        .update(testGenerations)
        .set({ status: 'completed', message: 'No Java methods modified in PR' })
        .where(eq(testGenerations.id, generationId));
      return;
    }

    await db
      .update(testGenerations)
      .set({ status: 'validating', message: `Generating tests for ${allContexts.length} method(s)` })
      .where(eq(testGenerations.id, generationId));

    const executor = options.executor ?? new DockerJavaExecutor();

    // ---- 5. Process each modified method independently (Error Isolation)
    for (const ctx of allContexts) {
      const targetTestClassName = `${ctx.className}Test`;
      const [testRow] = await db
        .insert(generatedTests)
        .values({
          generationId,
          sourceFile: ctx.filePath,
          className: ctx.className,
          methodName: ctx.methodName,
          testClassName: targetTestClassName,
          testCode: '',
          status: 'GENERATING',
        })
        .returning();

      try {
        // LLM Generation
        const llmResult = await generateTestForMethod(deps.llm, ctx);
        const generatedCode = llmResult.data.testCode;
        const testClassName = llmResult.data.testClassName || targetTestClassName;

        // Docker Sandbox Validation
        const valResult = await validateJavaTest({
          sourceCode: ctx.methodCode,
          sourceFileName: `${ctx.className}.java`,
          testCode: generatedCode,
          testFileName: `${testClassName}.java`,
          executor,
        });

        // Map ValidationResult status to GeneratedTestStatus
        let dbStatus:
          | 'PASSED'
          | 'FAILED'
          | 'REJECTED'
          | 'TIMEOUT'
          | 'ERROR' = 'ERROR';

        if (valResult.status === 'PASSED') dbStatus = 'PASSED';
        else if (valResult.status === 'TEST_FAILURE') dbStatus = 'FAILED';
        else if (valResult.status === 'COMPILE_ERROR') dbStatus = 'REJECTED';
        else if (valResult.status === 'TIMEOUT') dbStatus = 'TIMEOUT';

        await db
          .update(generatedTests)
          .set({
            testClassName,
            testCode: generatedCode,
            rawLlmOutput: JSON.stringify(llmResult.data),
            status: dbStatus,
            compileSuccess: valResult.compiled,
            compileError: valResult.compileErrors?.join('\n') ?? null,
            testSuccess: valResult.passed,
            executionOutput: valResult.stdout ?? null,
            executionError: valResult.stderr ?? valResult.testFailures?.join('\n') ?? null,
            durationMs: valResult.durationMs ?? 0,
          })
          .where(eq(generatedTests.id, testRow!.id));
      } catch (err: any) {
        log('test-gen', 'method processing failed', {
          method: ctx.methodName,
          error: err.message,
        });

        await db
          .update(generatedTests)
          .set({
            status: 'ERROR',
            executionError: err.message ?? String(err),
          })
          .where(eq(generatedTests.id, testRow!.id));
      }
    }

    // ---- 6. Mark generation completed
    await db
      .update(testGenerations)
      .set({
        status: 'completed',
        message: `Generated and validated tests for ${allContexts.length} method(s) in ${Date.now() - started}ms`,
      })
      .where(eq(testGenerations.id, generationId));

    log('test-gen', 'test generation completed', { prId: job.prId, methods: allContexts.length, ms: Date.now() - started });
  } catch (err: any) {
    log('test-gen', 'test generation failed', { prId: job.prId, error: err.message });

    await db
      .update(testGenerations)
      .set({
        status: 'failed',
        message: err.message.slice(0, 300),
      })
      .where(eq(testGenerations.id, generationId));

    throw err; // Allow BullMQ retry for retryable network/redis errors
  } finally {
    if (tmp.dir) {
      await rm(tmp.dir, { recursive: true, force: true });
    }
  }
}
