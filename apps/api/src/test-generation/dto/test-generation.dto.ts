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
