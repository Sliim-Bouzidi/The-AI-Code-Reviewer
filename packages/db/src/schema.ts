import { sql } from 'drizzle-orm';
import {
  bigint, boolean, index, integer, jsonb, pgTable, real, text, timestamp, unique, uuid, vector,
} from 'drizzle-orm/pg-core';
import type {
  Category, CustomRule, FindingSource, IndexStatus, ReviewStatus, ReviewTrigger, Severity, Strictness,
} from '@codereview/shared';

/** Must match the embedding model's output size. Changing it needs a new migration. */
export const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM ?? 768);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const installations = pgTable('installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubInstallationId: bigint('github_installation_id', { mode: 'number' }).notNull().unique(),
  accountLogin: text('account_login').notNull(),
  // null until the user finishes the "Connect GitHub" callback
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const repositories = pgTable('repositories', {
  id: uuid('id').primaryKey().defaultRandom(),
  installationId: uuid('installation_id')
    .notNull()
    .references(() => installations.id, { onDelete: 'cascade' }),
  githubRepoId: bigint('github_repo_id', { mode: 'number' }).notNull().unique(),
  fullName: text('full_name').notNull(),
  defaultBranch: text('default_branch'),
  enabled: boolean('enabled').notNull().default(false),
  indexStatus: text('index_status').$type<IndexStatus>().notNull().default('none'),
  lastIndexedSha: text('last_indexed_sha'),
  // "provider:model" the index was built with: vectors from another embedder cannot be searched
  embeddingModel: text('embedding_model'),
  // human-readable progress while indexing ("Embedding 120/620"), or the reason it failed
  indexProgress: text('index_progress'),
});

export const repoSettings = pgTable('repo_settings', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  strictness: text('strictness').$type<Strictness>().notNull().default('medium'),
  customRules: jsonb('custom_rules').$type<CustomRule[]>().notNull().default([]),
  ignoredPaths: text('ignored_paths').array().notNull().default(sql`'{}'::text[]`),
  maxComments: integer('max_comments').notNull().default(15),
});

export const pullRequests = pgTable(
  'pull_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title'),
    author: text('author'),
    headSha: text('head_sha'),
    baseSha: text('base_sha'),
    status: text('status').$type<'open' | 'closed' | 'merged'>(),
  },
  (t) => [unique('pull_requests_repo_number').on(t.repoId, t.number)],
);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // pr_id / repo_id are null for local MCP reviews; user_id is who asked for an MCP review
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repositories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    headSha: text('head_sha'),
    trigger: text('trigger').$type<ReviewTrigger>().notNull(),
    status: text('status').$type<ReviewStatus>().notNull(),
    provider: text('provider'),
    model: text('model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    durationMs: integer('duration_ms'),
    summary: text('summary'),
    error: text('error'),
    checkRunId: bigint('check_run_id', { mode: 'number' }), // GitHub check run shown on the PR
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reviews_repo_created').on(t.repoId, t.createdAt)],
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    lineStart: integer('line_start').notNull(),
    lineEnd: integer('line_end'),
    severity: text('severity').$type<Severity>().notNull(),
    category: text('category').$type<Category>().notNull(),
    source: text('source').$type<FindingSource>().notNull(),
    message: text('message').notNull(),
    suggestion: text('suggestion'),
    confidence: real('confidence'),
    posted: boolean('posted').notNull().default(false),
    githubCommentId: bigint('github_comment_id', { mode: 'number' }),
  },
  (t) => [index('findings_review').on(t.reviewId)],
);

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    symbol: text('symbol'),
    language: text('language'),
    startLine: integer('start_line'),
    endLine: integer('end_line'),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    commitSha: text('commit_sha'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
  },
  (t) => [
    index('code_chunks_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('code_chunks_repo_file').on(t.repoId, t.filePath),
  ],
);

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  prefix: text('prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/**
 * The GitHub App this install talks to (single row). Filled by the dashboard's one-click
 * "Create GitHub App" flow (GitHub manifest); the GITHUB_APP_* env vars are only a fallback.
 */
export const githubApp = pgTable('github_app', {
  id: text('id').primaryKey().default('default'),
  appId: bigint('app_id', { mode: 'number' }).notNull(),
  slug: text('slug').notNull(),
  privateKey: text('private_key').notNull(),
  webhookSecret: text('webhook_secret').notNull(),
  htmlUrl: text('html_url'),
  // the app's admin: only this user may recreate/replace it, and env AI keys are always theirs to use
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * AI provider settings saved from the dashboard, one row per user: each user brings their own keys and
 * models, used for the reviews, indexing and evals of their repositories. A null column means "use the
 * env default" (env keys only when shared, see getLlmEnv). Keys are never sent back to the browser.
 * Demo limitation: stored as plain text, like the GitHub App private key.
 */
export const llmSettings = pgTable('llm_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  geminiApiKey: text('gemini_api_key'),
  openrouterApiKey: text('openrouter_api_key'),
  openaiCompatBaseUrl: text('openai_compat_base_url'),
  openaiCompatApiKey: text('openai_compat_api_key'),
  anthropicApiKey: text('anthropic_api_key'), // paid: Claude
  openaiApiKey: text('openai_api_key'), // paid: OpenAI's own API (GPT, embeddings)
  llmProvider: text('llm_provider'),
  llmModel: text('llm_model'),
  llmFallbackProvider: text('llm_fallback_provider'),
  llmFallbackModel: text('llm_fallback_model'),
  embeddingModel: text('embedding_model'), // Gemini embedding model
  embeddingProvider: text('embedding_provider'), // gemini | openai-api; null = automatic
  openaiEmbeddingModel: text('openai_embedding_model'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per pipeline stage of a review, so the dashboard can show the agent working live. */
export const reviewEvents = pgTable(
  'review_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(), // fetch | static_analysis | context | llm | validate | post
    status: text('status').$type<'running' | 'done' | 'skipped' | 'failed'>().notNull(),
    detail: text('detail'), // short human text, never source code
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('review_events_review_created').on(t.reviewId, t.createdAt)],
);

/** One "Run evals" from the Quality page: totals across all cases (evals/). */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').$type<'queued' | 'running' | 'completed' | 'failed'>().notNull(),
    provider: text('provider'), // model that answered most cases
    model: text('model'),
    casesTotal: integer('cases_total'),
    casesDone: integer('cases_done').notNull().default(0),
    expected: integer('expected').notNull().default(0),
    caught: integer('caught').notNull().default(0),
    findings: integer('findings').notNull().default(0),
    onTarget: integer('on_target').notNull().default(0),
    falseAlarms: integer('false_alarms').notNull().default(0),
    durationMs: integer('duration_ms'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('eval_runs_user_created').on(t.userId, t.createdAt)],
);

/** Score of one eval case within a run. */
export const evalCaseResults = pgTable(
  'eval_case_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => evalRuns.id, { onDelete: 'cascade' }),
    caseName: text('case_name').notNull(),
    description: text('description'),
    expected: integer('expected').notNull(),
    caught: integer('caught').notNull(),
    findings: integer('findings').notNull(),
    onTarget: integer('on_target').notNull(),
    falseAlarms: integer('false_alarms').notNull(),
    missed: jsonb('missed').$type<string[]>().notNull().default([]),
    reviewId: uuid('review_id').references(() => reviews.id, { onDelete: 'set null' }),
    durationMs: integer('duration_ms'),
    error: text('error'),
  },
  (t) => [index('eval_case_results_run').on(t.runId)],
);

/** Dashboard notifications ("review finished", "indexing failed", ...). Written by the worker. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'review_completed' | 'review_failed' | 'index_ready' | 'index_failed' | 'eval_completed' | 'eval_failed'>().notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'), // dashboard path to open, e.g. /dashboard/reviews/<id>
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_created').on(t.userId, t.createdAt)],
);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  event: text('event'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One test-generation run for a given pull request.
 * A single PR may have at most one active run; re-runs create a new row.
 */
export const testGenerations = pgTable(
  'test_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The pull request that triggered this generation. */
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** Repository – denormalized for quick queries without joining through PR. */
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    /** HEAD commit SHA of the PR at the time of generation. */
    headSha: text('head_sha').notNull(),
    /**
     * Overall status of the generation run.
     * pending → generating → generated → validating → completed | failed
     */
    status: text('status')
      .$type<'pending' | 'generating' | 'generated' | 'validating' | 'completed' | 'failed'>()
      .notNull()
      .default('pending'),
    /** Short human-readable message (error reason, progress note, …). */
    message: text('message'),
    /** Line coverage % on HEAD before generation (0–100), null if not measured. */
    coverageBefore: integer('coverage_before'),
    /** Line coverage % estimated after adding valid tests (0–100), null if not measured. */
    coverageAfter: integer('coverage_after'),
    /** coverageAfter − coverageBefore, stored for easy sorting. */
    coverageGain: integer('coverage_gain'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('test_generations_pr').on(t.prId),
    index('test_generations_repo_created').on(t.repoId, t.createdAt),
  ],
);

/**
 * One generated test case (targeting one Java method).
 * Multiple rows per test_generation run (one per modified method).
 */
export const generatedTests = pgTable(
  'generated_tests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    generationId: uuid('generation_id')
      .notNull()
      .references(() => testGenerations.id, { onDelete: 'cascade' }),
    /** Relative path to the Java source file, e.g. "src/main/java/com/example/UserService.java". */
    sourceFile: text('source_file').notNull(),
    /** Simple name of the Java class, e.g. "UserService". */
    className: text('class_name').notNull(),
    /** Name of the method under test, e.g. "createUser". */
    methodName: text('method_name').notNull(),
    /** Full name of the generated test class, e.g. "UserServiceTest". */
    testClassName: text('test_class_name').notNull(),
    /** Complete Java source of the generated test class (JUnit 5 + Mockito). */
    testCode: text('test_code').notNull(),
    /** Raw LLM response before any parsing/validation. */
    rawLlmOutput: text('raw_llm_output'),
    /**
     * Fine-grained lifecycle status of this individual test.
     * PENDING → GENERATING → GENERATED → COMPILING → RUNNING → PASSED
     *                                                          → FAILED
     *                                                          → TIMEOUT
     *                                                          → ERROR
     *                                              → REJECTED  (compile failed)
     */
    status: text('status')
      .$type<
        | 'PENDING'
        | 'GENERATING'
        | 'GENERATED'
        | 'COMPILING'
        | 'RUNNING'
        | 'PASSED'
        | 'FAILED'
        | 'REJECTED'
        | 'TIMEOUT'
        | 'ERROR'
      >()
      .notNull()
      .default('PENDING'),
    /** Did the Docker sandbox compilation succeed? null = not attempted. */
    compileSuccess: boolean('compile_success'),
    /** Raw javac / Maven stderr output from the compilation step. */
    compileError: text('compile_error'),
    /** Did all test methods execute and pass? null = not attempted. */
    testSuccess: boolean('test_success'),
    /** JVM / JUnit output from the test-execution step. */
    executionOutput: text('execution_output'),
    /** Error message when executionSuccess is false. */
    executionError: text('execution_error'),
    /** Wall-clock time (ms) of the Docker sandbox run (compile + execute). */
    durationMs: integer('duration_ms'),
    /** Whether this test was posted as a GitHub PR suggestion. */
    postedToGithub: boolean('posted_to_github').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('generated_tests_generation').on(t.generationId)],
);
