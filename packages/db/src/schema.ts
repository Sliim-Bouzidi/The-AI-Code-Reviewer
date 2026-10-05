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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * AI provider settings saved from the dashboard (single row). Every column is optional: a null value
 * means "use the env var". Read through getLlmEnv (packages/db). Keys are never sent back to the browser.
 * Demo limitation: stored as plain text, like the GitHub App private key.
 */
export const llmSettings = pgTable('llm_settings', {
  id: text('id').primaryKey().default('default'),
  geminiApiKey: text('gemini_api_key'),
  openrouterApiKey: text('openrouter_api_key'),
  openaiCompatBaseUrl: text('openai_compat_base_url'),
  openaiCompatApiKey: text('openai_compat_api_key'),
  llmProvider: text('llm_provider'),
  llmModel: text('llm_model'),
  llmFallbackProvider: text('llm_fallback_provider'),
  llmFallbackModel: text('llm_fallback_model'),
  embeddingModel: text('embedding_model'),
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

/** Dashboard notifications ("review finished", "indexing failed", ...). Written by the worker. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'review_completed' | 'review_failed' | 'index_ready' | 'index_failed'>().notNull(),
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
