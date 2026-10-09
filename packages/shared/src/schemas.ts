import { z } from 'zod';

// ---------- enums ----------
export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export const CategorySchema = z.enum(['bug', 'security', 'performance', 'style', 'maintainability']);
export const FindingSourceSchema = z.enum(['llm', 'semgrep']);
export const StrictnessSchema = z.enum(['low', 'medium', 'high']);
export const ReviewStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export const ReviewTriggerSchema = z.enum(['webhook', 'manual', 'mcp', 'eval']); // manual = re-run from the dashboard; eval = internal review of an eval case
export const IndexStatusSchema = z.enum(['none', 'indexing', 'ready', 'failed']);

export type Severity = z.infer<typeof SeveritySchema>;
export type Category = z.infer<typeof CategorySchema>;
export type FindingSource = z.infer<typeof FindingSourceSchema>;
export type Strictness = z.infer<typeof StrictnessSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type ReviewTrigger = z.infer<typeof ReviewTriggerSchema>;
export type IndexStatus = z.infer<typeof IndexStatusSchema>;

// ---------- LLM output (section 7, step 6) ----------
export const SemgrepDecisionStateSchema = z.enum(['CONFIRMED', 'REJECTED', 'UNCERTAIN']);
export type SemgrepDecisionState = z.infer<typeof SemgrepDecisionStateSchema>;

export const SemgrepDecisionSchema = z.object({
  alert_id: z.string(),
  decision: SemgrepDecisionStateSchema,
  reason: z.string().default(''),
});
export type SemgrepDecision = z.infer<typeof SemgrepDecisionSchema>;

export const SemgrepAlertSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  filePath: z.string(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive().nullable(),
  severity: SeveritySchema,
  category: CategorySchema,
  message: z.string(),
});
export type SemgrepAlert = z.infer<typeof SemgrepAlertSchema>;

export const LlmFindingSchema = z.object({
  file: z.string().min(1),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive().nullish(),
  severity: SeveritySchema,
  category: CategorySchema,
  message: z.string().min(1),
  suggestion: z.string().nullish(),
  confidence: z.number().min(0).max(1),
});
export const LlmReviewOutputSchema = z.object({
  summary: z.string().default(''),
  findings: z.array(LlmFindingSchema).default([]),
  semgrep_decisions: z.array(SemgrepDecisionSchema).default([]),
});
export type LlmFinding = z.infer<typeof LlmFindingSchema>;
export type LlmReviewOutput = z.infer<typeof LlmReviewOutputSchema>;

// ---------- findings ----------
/** A finding before it is persisted (LLM or Semgrep), in pipeline-internal shape. */
export const CandidateFindingSchema = z.object({
  filePath: z.string(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive().nullable(),
  severity: SeveritySchema,
  category: CategorySchema,
  source: FindingSourceSchema,
  message: z.string(),
  suggestion: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  ruleId: z.string().optional(),
  semgrepDecision: SemgrepDecisionStateSchema.optional(),
  semgrepReason: z.string().optional(),
  tier1Decision: SemgrepDecisionStateSchema.optional(),
  tier2Decision: SemgrepDecisionStateSchema.optional(),
});
export type CandidateFinding = z.infer<typeof CandidateFindingSchema>;

export const ReviewMetricsSchema = z.object({
  triageProvider: z.string(),
  triageModel: z.string(),
  escalated: z.boolean(),
  escalationReason: z.string().nullable(),
  escalationProvider: z.string().nullable(),
  escalationModel: z.string().nullable(),
  totalCalls: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  // Batching metrics (Étape 4)
  totalAlerts: z.number().int().nonnegative().optional(),
  totalBatches: z.number().int().nonnegative().optional(),
  estimatedBatchTokens: z.number().int().nonnegative().optional(),
  tier1Calls: z.number().int().nonnegative().optional(),
  tier2Calls: z.number().int().nonnegative().optional(),
  missingAlerts: z.number().int().nonnegative().optional(),
  fallbackAlerts: z.number().int().nonnegative().optional(),
  alertFinalStates: z.array(
    z.object({
      alertId: z.string(),
      ruleId: z.string(),
      filePath: z.string().optional(),
      tier1Decision: SemgrepDecisionStateSchema.optional(),
      tier2Decision: SemgrepDecisionStateSchema.optional(),
      finalDecision: SemgrepDecisionStateSchema,
      reason: z.string(),
    }),
  ),
});
export type ReviewMetrics = z.infer<typeof ReviewMetricsSchema>;

export const FindingSchema = CandidateFindingSchema.extend({
  id: z.string(),
  reviewId: z.string(),
  posted: z.boolean(),
  githubCommentId: z.number().nullable(),
});
export type Finding = z.infer<typeof FindingSchema>;

// ---------- repos & settings ----------
export const CustomRuleSchema = z.object({
  rule: z.string().min(1),
  severity: SeveritySchema.default('low'),
});
export type CustomRule = z.infer<typeof CustomRuleSchema>;

export const RepoSettingsSchema = z.object({
  strictness: StrictnessSchema,
  customRules: z.array(CustomRuleSchema),
  ignoredPaths: z.array(z.string()),
  maxComments: z.number().int().min(1).max(50),
});
export type RepoSettings = z.infer<typeof RepoSettingsSchema>;
export const UpdateRepoSettingsSchema = RepoSettingsSchema.partial();
export type UpdateRepoSettings = z.infer<typeof UpdateRepoSettingsSchema>;

export const DEFAULT_REPO_SETTINGS: RepoSettings = {
  strictness: 'medium',
  customRules: [],
  ignoredPaths: [],
  maxComments: 15,
};

export const RepoSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  defaultBranch: z.string().nullable(),
  enabled: z.boolean(),
  indexStatus: IndexStatusSchema,
  lastIndexedSha: z.string().nullable(),
  /** Progress text while indexing ("Embedding 120/620 chunks"), or why the last index failed. */
  indexProgress: z.string().nullable(),
  /** "provider:model" the index was built with (null for older indexes). */
  embeddingModel: z.string().nullable(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const EnableRepoBodySchema = z.object({ enabled: z.boolean() });

// ---------- reviews ----------
export const ReviewSchema = z.object({
  id: z.string(),
  repoId: z.string().nullable(),
  prId: z.string().nullable(),
  prNumber: z.number().nullable(),
  prTitle: z.string().nullable(),
  headSha: z.string().nullable(),
  trigger: ReviewTriggerSchema,
  status: ReviewStatusSchema,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  durationMs: z.number().nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const ReviewWithFindingsSchema = ReviewSchema.extend({ findings: z.array(FindingSchema) });
export type ReviewWithFindings = z.infer<typeof ReviewWithFindingsSchema>;

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const PaginatedReviewsSchema = z.object({
  items: z.array(ReviewSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type PaginatedReviews = z.infer<typeof PaginatedReviewsSchema>;

export const StatsSchema = z.object({
  totalReviews: z.number(),
  totalFindings: z.number(),
  activeRepos: z.number(),
});
export type Stats = z.infer<typeof StatsSchema>;

/** POST /api/reviews/diff. `repo` is "owner/name" and is optional (no codebase context without it). */
export const ReviewDiffBodySchema = z.object({
  diff: z.string().min(1).max(1_500_000),
  repo: z.string().optional(),
});
export type ReviewDiffBody = z.infer<typeof ReviewDiffBodySchema>;
export const ReviewDiffResponseSchema = z.object({ reviewId: z.string() });
export const ReviewStatusResponseSchema = z.object({
  status: ReviewStatusSchema,
  error: z.string().nullable(),
});
export type ReviewStatusResponse = z.infer<typeof ReviewStatusResponseSchema>;

// ---------- search & rules ----------
export const SearchBodySchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(25).default(8),
});
export type SearchBody = z.infer<typeof SearchBodySchema>;
export const SearchResultSchema = z.object({
  filePath: z.string(),
  symbol: z.string().nullable(),
  language: z.string().nullable(),
  startLine: z.number().nullable(),
  endLine: z.number().nullable(),
  content: z.string(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const RulesResponseSchema = z.object({
  strictness: StrictnessSchema,
  customRules: z.array(CustomRuleSchema),
  ignoredPaths: z.array(z.string()),
});
export type RulesResponse = z.infer<typeof RulesResponseSchema>;

// ---------- AI providers (dashboard settings) ----------
/** Free tiers: gemini, openrouter, openai (= OpenAI-compatible hosts). Paid: anthropic (Claude), openai-api (GPT). */
export const LlmProviderNameSchema = z.enum(['gemini', 'openrouter', 'openai', 'anthropic', 'openai-api']);
export const EmbeddingProviderNameSchema = z.enum(['gemini', 'openai-api']);
export type LlmProviderName = z.infer<typeof LlmProviderNameSchema>;

/**
 * PUT /api/settings/llm. Every field optional; "" clears the dashboard value (the `.env` one applies
 * again). Keys are write-only: GET never returns them.
 */
const optionalText = (max: number) => z.string().trim().max(max).optional();
export const UpdateLlmSettingsSchema = z.object({
  geminiApiKey: optionalText(300),
  openrouterApiKey: optionalText(300),
  openaiCompatBaseUrl: z.union([z.literal(''), z.string().trim().url().max(300)]).optional(),
  openaiCompatApiKey: optionalText(300),
  anthropicApiKey: optionalText(300),
  openaiApiKey: optionalText(300),
  llmProvider: z.union([z.literal(''), LlmProviderNameSchema]).optional(),
  llmModel: optionalText(200),
  llmFallbackProvider: z.union([z.literal(''), LlmProviderNameSchema]).optional(),
  llmFallbackModel: optionalText(200),
  embeddingModel: optionalText(200),
  embeddingProvider: z.union([z.literal(''), EmbeddingProviderNameSchema]).optional(), // '' = automatic
  openaiEmbeddingModel: optionalText(200),
});
export type UpdateLlmSettings = z.infer<typeof UpdateLlmSettingsSchema>;

/** Where a value comes from: saved in the dashboard, the `.env` file, or nowhere. */
export type SettingSource = 'dashboard' | 'env' | null;
export interface LlmKeyStatus {
  set: boolean;
  last4: string | null; // only the last 4 characters, for recognition
  source: SettingSource;
}
export interface LlmSlotStatus {
  provider: string | null; // label of the provider actually used ("gemini", "nvidia", ...)
  model: string | null;
  configured: boolean;
}
export interface LlmSettingsResponse {
  keys: {
    gemini: LlmKeyStatus;
    openrouter: LlmKeyStatus;
    openai: LlmKeyStatus & { baseUrl: string | null }; // OpenAI-compatible host
    anthropic: LlmKeyStatus;
    openaiApi: LlmKeyStatus;
  };
  choice: {
    llmProvider: string | null;
    llmModel: string | null;
    llmFallbackProvider: string | null;
    llmFallbackModel: string | null;
    embeddingModel: string | null;
    embeddingProvider: string | null; // null = automatic
    openaiEmbeddingModel: string | null;
  };
  active: { primary: LlmSlotStatus; fallback: LlmSlotStatus; embeddings: LlmSlotStatus & { id: string | null } };
  /** true when this user must bring their own keys (the server's keys are not shared with them). */
  ownKeysRequired: boolean;
}

export const TestLlmBodySchema = z.object({ slot: z.enum(['primary', 'fallback', 'embeddings']) });
export interface TestLlmResponse {
  ok: boolean;
  ms: number;
  provider: string | null;
  model: string | null;
  message: string;
}

// ---------- quality evals ----------
export type EvalRunStatus = 'queued' | 'running' | 'completed' | 'failed';
export interface EvalCaseResult {
  caseName: string;
  description: string | null;
  expected: number; // planted issues in the answer key
  caught: number; // planted issues the reviewer found
  findings: number; // everything the reviewer reported
  onTarget: number; // findings that hit a planted issue
  falseAlarms: number; // on the clean case: findings above the allowed severity
  missed: string[]; // planted issues it did not find
  reviewId: string | null;
  durationMs: number | null;
  error: string | null;
}
export interface EvalRun {
  id: string;
  status: EvalRunStatus;
  provider: string | null;
  model: string | null;
  casesTotal: number | null;
  casesDone: number;
  expected: number;
  caught: number;
  findings: number;
  onTarget: number;
  falseAlarms: number;
  recall: number | null; // caught / expected, 0..1
  precision: number | null; // onTarget / findings, 0..1
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  cases: EvalCaseResult[];
}

// ---------- sign-in setup ----------
/** POST /api/setup/clerk: first-run setup, the two keys from the Clerk dashboard. */
export const ClerkKeysBodySchema = z.object({
  publishableKey: z.string().trim().min(10).max(500),
  secretKey: z.string().trim().min(10).max(500),
});
export type ClerkKeysBody = z.infer<typeof ClerkKeysBodySchema>;

// ---------- API keys ----------
export const ApiKeySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  prefix: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;
export const CreateApiKeyBodySchema = z.object({ name: z.string().min(1).max(80) });
/** `key` is the raw key and is returned exactly once. */
export const CreateApiKeyResponseSchema = ApiKeySchema.extend({ key: z.string() });
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponseSchema>;
