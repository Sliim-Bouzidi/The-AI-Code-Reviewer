import { z } from 'zod';

// ─── Status enums ────────────────────────────────────────────────────────────

export const TestGenerationRunStatusSchema = z.enum([
  'pending',
  'generating',
  'generated',
  'validating',
  'completed',
  'failed',
]);
export type TestGenerationRunStatus = z.infer<typeof TestGenerationRunStatusSchema>;

export const GeneratedTestStatusSchema = z.enum([
  'PENDING',
  'GENERATING',
  'GENERATED',
  'COMPILING',
  'RUNNING',
  'PASSED',
  'FAILED',
  'REJECTED',
  'TIMEOUT',
  'ERROR',
]);
export type GeneratedTestStatus = z.infer<typeof GeneratedTestStatusSchema>;

// ─── LLM output schema ───────────────────────────────────────────────────────

/** One test method within the generated test class. */
export const TestCaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['NORMAL', 'EDGE_CASE', 'ERROR']),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

/**
 * The structured JSON the LLM must return for each method.
 * Validated with Zod before any further processing.
 */
export const LlmTestOutputSchema = z.object({
  testClassName: z.string().min(1),
  /** List of fully-qualified import statements. */
  imports: z.array(z.string()),
  /** Class-level annotations if any, e.g. ["@ExtendWith(MockitoExtension.class)"]. */
  annotations: z.array(z.string()).optional(),
  /** Full Java source code of the test class (ready to compile). */
  testCode: z.string().min(1),
  /** Metadata for each @Test method present in testCode. */
  tests: z.array(TestCaseSchema).min(1),
});
export type LlmTestOutput = z.infer<typeof LlmTestOutputSchema>;

// ─── Validation result schema (Phase 4) ──────────────────────────────────────

export const ValidationResultStatusSchema = z.enum([
  'PASSED',
  'COMPILE_ERROR',
  'TEST_FAILURE',
  'TIMEOUT',
  'RUNTIME_ERROR',
  'DOCKER_ERROR',
]);
export type ValidationResultStatus = z.infer<typeof ValidationResultStatusSchema>;

export const ValidationResultSchema = z.object({
  status: ValidationResultStatusSchema,
  compiled: z.boolean(),
  executed: z.boolean(),
  passed: z.boolean(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  compileErrors: z.array(z.string()).optional(),
  testFailures: z.array(z.string()).optional(),
  durationMs: z.number().optional(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// ─── API DTO Interfaces (Phase 7 & 8) ────────────────────────────────────────

export interface TestGenerationSummaryDto {
  id: string;
  prId: string;
  repoId: string;
  headSha: string;
  status: string;
  message: string | null;
  coverageBefore: number | null;
  coverageAfter: number | null;
  coverageGain: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeneratedTestSummaryDto {
  id: string;
  sourceFile: string;
  className: string;
  methodName: string;
  testClassName: string;
  status: string;
  compileSuccess: boolean | null;
  testSuccess: boolean | null;
  durationMs: number | null;
  postedToGithub: boolean;
  createdAt: Date;
}

export interface TestGenerationDetailsDto extends TestGenerationSummaryDto {
  generatedTests: GeneratedTestSummaryDto[];
}

export interface GeneratedTestDetailDto extends GeneratedTestSummaryDto {
  testCode: string;
  rawLlmOutput: string | null;
  compileError: string | null;
  executionOutput: string | null;
  executionError: string | null;
}

export interface TriggerTestGenerationResponseDto {
  generationId: string;
  jobId: string;
  status: string;
}

export interface TestGenerationStatusResponseDto {
  id: string;
  status: string;
  message: string | null;
  progress: {
    total: number;
    completed: number;
    passed: number;
    failed: number;
  };
}


