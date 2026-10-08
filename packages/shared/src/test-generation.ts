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

