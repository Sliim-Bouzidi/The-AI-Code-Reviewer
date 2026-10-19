import { createHash } from 'node:crypto';
import type { Db } from '@codereview/db';
import { eq, llmCache, sql } from '@codereview/db';
import type { CandidateFinding, SemgrepDecisionState } from '@codereview/shared';
import { SemgrepDecisionStateSchema } from '@codereview/shared';

import type { CustomRule, Strictness } from '@codereview/shared';

export interface CacheKeyInput {
  targetedContext: string;
  alert: {
    id: string;
    filePath: string;
    ruleId: string;
    severity: string;
    category: string;
    lineStart: number;
    lineEnd: number | null;
    message: string;
  };
  tier: 1 | 2;
  provider: string;
  model: string;
  rules?: CustomRule[];
  strictness?: Strictness;
  escalationPolicy?: Record<string, boolean>;
  promptVersion?: string;
  schemaVersion?: string;
  policyVersion?: string;
}

export interface CacheEntry {
  decision: SemgrepDecisionState;
  reason: string;
  findings?: CandidateFinding[];
  provider: string;
  model: string;
  tier: 1 | 2;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
  expiresAt?: string;
}

/**
 * Estimates counterfactual USD cost saved by avoiding LLM calls.
 * Assumes standard economic tier pricing ($0.15 per 1M input tokens, $0.60 per 1M output tokens).
 */
export function estimateSavedCostUsd(savedTokensIn: number, savedTokensOut: number): number {
  const inputCost = (savedTokensIn / 1_000_000) * 0.15;
  const outputCost = (savedTokensOut / 1_000_000) * 0.60;
  return Number((inputCost + outputCost).toFixed(6));
}

/**
 * Computes a deterministic SHA-256 hash from a canonical representation
 * of all inputs that influence the LLM decision (context, alert metadata, model, rules, strictness, policy).
 */
export function createCacheKey(input: CacheKeyInput): string {
  const canonical = {
    alert: {
      id: input.alert.id,
      filePath: input.alert.filePath,
      ruleId: input.alert.ruleId,
      severity: input.alert.severity,
      category: input.alert.category,
      lineStart: input.alert.lineStart,
      lineEnd: input.alert.lineEnd,
      message: input.alert.message,
    },
    context: input.targetedContext,
    model: {
      provider: input.provider,
      model: input.model,
      tier: input.tier,
    },
    settings: {
      strictness: input.strictness ?? 'medium',
      rules: (input.rules ?? []).map((r) => ({ rule: r.rule, severity: r.severity })),
    },
    policy: input.escalationPolicy ?? {},
    version: {
      prompt: input.promptVersion ?? 'v1',
      schema: input.schemaVersion ?? 'v1',
      policy: input.policyVersion ?? 'v1',
    },
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface SyntheticCacheKeyInput {
  filePath: string;
  fileContentHash: string;
  targetedContext: string;
  provider: string;
  model: string;
  rules?: CustomRule[];
  strictness?: Strictness;
  promptVersion?: string;
  schemaVersion?: string;
}

/**
 * Computes a deterministic SHA-256 hash of a file's content or diff.
 * Prioritizes full file content if available, then diff hunks, then targeted context.
 */
export function computeFileContentHash(
  fileContent?: string,
  file?: { hunks?: Array<{ header: string; lines: string[] }> },
  targetedContext?: string,
): string {
  const hasher = createHash('sha256');
  if (fileContent && fileContent.length > 0) {
    hasher.update('full:').update(fileContent);
  } else if (file?.hunks && file.hunks.length > 0) {
    hasher.update('hunks:');
    for (const hunk of file.hunks) {
      hasher.update(hunk.header).update(hunk.lines.join('\n'));
    }
  } else if (targetedContext && targetedContext.length > 0) {
    hasher.update('ctx:').update(targetedContext);
  } else {
    hasher.update('empty');
  }
  return hasher.digest('hex');
}

/**
 * Computes a deterministic cache key for synthetic file items (files without Semgrep alerts).
 * Incorporates file path, file content hash, targeted context, model, rules, and versions.
 */
export function createSyntheticFileCacheKey(input: SyntheticCacheKeyInput): string {
  const canonical = {
    filePath: input.filePath,
    fileContentHash: input.fileContentHash,
    isSynthetic: true,
    context: input.targetedContext,
    model: {
      provider: input.provider,
      model: input.model,
      tier: 1,
    },
    settings: {
      strictness: input.strictness ?? 'medium',
      rules: (input.rules ?? []).map((r) => ({ rule: r.rule, severity: r.severity })),
    },
    version: {
      prompt: input.promptVersion ?? 'v1',
      schema: input.schemaVersion ?? 'v1',
    },
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface CleanExpiredOptions {
  batchSize?: number;
  maxBatches?: number;
  before?: Date;
  keyPrefix?: string;
}

export interface LlmCacheStore {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry, ttlMs?: number): Promise<void>;
  cleanExpired?(options?: CleanExpiredOptions): Promise<number>;
  clear?(): void;
}

/** Default TTL for cache entries: 30 days in milliseconds */
export const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Default batch size for expired entry pruning */
export const DEFAULT_CLEANUP_BATCH_SIZE = 500;
/** Default maximum number of batches to prune in a single cleanup invocation */
export const DEFAULT_CLEANUP_MAX_BATCHES = 50;

/**
 * Prunes expired entries from PostgreSQL llm_cache in batches using FOR UPDATE SKIP LOCKED.
 * Guarantees:
 * 1. Only entries where expires_at < cutoff (NOW() by default) are deleted.
 * 2. Small transaction batches avoid holding exclusive locks or creating WAL surges.
 * 3. FOR UPDATE SKIP LOCKED ensures concurrent reads/writes are NEVER blocked and no deadlocks occur.
 * 4. Returns the total count of deleted rows.
 */
export async function cleanExpiredLlmCache(
  db: Db,
  options: CleanExpiredOptions = {},
): Promise<number> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_CLEANUP_BATCH_SIZE);
  const maxBatches = Math.max(1, options.maxBatches ?? DEFAULT_CLEANUP_MAX_BATCHES);
  const cutoffIso = (options.before ?? new Date()).toISOString();
  const prefixFilter = options.keyPrefix ? sql` AND cache_key LIKE ${options.keyPrefix + '%'}` : sql``;
  let totalDeleted = 0;

  for (let i = 0; i < maxBatches; i++) {
    const deletedRows = await db.execute<{ cache_key: string }>(sql`
      WITH to_delete AS (
        SELECT cache_key
        FROM llm_cache
        WHERE expires_at IS NOT NULL AND expires_at < ${cutoffIso}::timestamptz${prefixFilter}
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM llm_cache
      WHERE cache_key IN (SELECT cache_key FROM to_delete)
      RETURNING cache_key
    `);

    const count = Array.isArray(deletedRows) ? deletedRows.length : 0;
    totalDeleted += count;

    // If this batch deleted fewer rows than batchSize, there are no more expired rows
    if (count < batchSize) {
      break;
    }
  }

  return totalDeleted;
}

export interface DbLlmCacheStoreOptions {
  cleanupIntervalMs?: number;
  cleanupBatchSize?: number;
  enableAutoCleanup?: boolean;
}

/**
 * Persistent DB-backed LLM Cache store with automatic in-memory fallback.
 * Uses PostgreSQL `@codereview/db` `llmCache` table with atomic upserts and safe batch cleanup.
 */
export class DbLlmCacheStore implements LlmCacheStore {
  private memoryFallback = new Map<string, { entry: CacheEntry; expiresAtMs: number | null }>();
  public errorCount = 0;
  private lastAutoCleanupMs = Date.now();
  private cleanupIntervalMs: number;
  private cleanupBatchSize: number;
  private enableAutoCleanup: boolean;

  constructor(
    private db?: Db | null,
    options: DbLlmCacheStoreOptions = {},
  ) {
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60 * 60 * 1000; // 1 hour
    this.cleanupBatchSize = options.cleanupBatchSize ?? DEFAULT_CLEANUP_BATCH_SIZE;
    this.enableAutoCleanup = options.enableAutoCleanup ?? false;
    this.lastAutoCleanupMs = Date.now();
  }

  private maybeTriggerAutoCleanup(): void {
    if (!this.enableAutoCleanup || !this.db) return;
    const now = Date.now();
    if (now - this.lastAutoCleanupMs < this.cleanupIntervalMs) return;

    this.lastAutoCleanupMs = now;
    // Launch background batch cleanup asynchronously; errors are safely caught and tracked
    void this.cleanExpired({ batchSize: this.cleanupBatchSize }).catch(() => {});
  }

  async get(key: string): Promise<CacheEntry | null> {
    const nowMs = Date.now();

    // 1. Try DB read if DB is available
    if (this.db) {
      try {
        const [row] = await this.db.select().from(llmCache).where(eq(llmCache.cacheKey, key));
        if (row) {
          if (row.expiresAt && new Date(row.expiresAt).getTime() < nowMs) {
            // Opportunistic deletion of expired row on access
            try {
              await this.db.delete(llmCache).where(eq(llmCache.cacheKey, key));
            } catch {
              this.errorCount++;
            }
            return null;
          }

          const rawData = row.data as any;
          if (rawData && SemgrepDecisionStateSchema.safeParse(rawData.decision).success) {
            this.maybeTriggerAutoCleanup();
            return {
              decision: rawData.decision as SemgrepDecisionState,
              reason: rawData.reason ?? '',
              findings: rawData.findings ?? [],
              provider: row.provider,
              model: row.model,
              tier: (row.tier as 1 | 2) ?? 1,
              tokensIn: row.tokensIn,
              tokensOut: row.tokensOut,
              createdAt: new Date(row.createdAt).toISOString(),
              expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : undefined,
            };
          }
        }
      } catch (err) {
        this.errorCount++;
        // Fallback to in-memory store on DB read error
      }
    }

    // 2. Memory store fallback
    const mem = this.memoryFallback.get(key);
    if (mem) {
      if (mem.expiresAtMs && mem.expiresAtMs < nowMs) {
        this.memoryFallback.delete(key);
        return null;
      }
      return mem.entry;
    }

    this.maybeTriggerAutoCleanup();
    return null;
  }

  async set(key: string, entry: CacheEntry, ttlMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
    const expiresAtMs = Date.now() + ttlMs;
    const expiresAt = new Date(expiresAtMs);

    // Always update in-memory fallback
    this.memoryFallback.set(key, { entry, expiresAtMs });

    // Try DB write if DB is available
    if (this.db) {
      try {
        const payload = {
          decision: entry.decision,
          reason: entry.reason,
          findings: entry.findings ?? [],
        };

        await this.db
          .insert(llmCache)
          .values({
            cacheKey: key,
            tier: entry.tier,
            provider: entry.provider,
            model: entry.model,
            data: payload,
            tokensIn: entry.tokensIn,
            tokensOut: entry.tokensOut,
            createdAt: new Date(),
            expiresAt: expiresAt,
          })
          .onConflictDoUpdate({
            target: llmCache.cacheKey,
            set: {
              data: payload,
              tokensIn: entry.tokensIn,
              tokensOut: entry.tokensOut,
              createdAt: new Date(),
              expiresAt: expiresAt,
            },
          });
      } catch (err) {
        this.errorCount++;
        // DB write failure isolated, memory fallback active
      }
    }

    this.maybeTriggerAutoCleanup();
  }

  /**
   * Purges expired entries from PostgreSQL (and in-memory fallback).
   * Safe to call from background jobs or on-demand: errors never throw and are tracked in errorCount.
   */
  async cleanExpired(options?: CleanExpiredOptions): Promise<number> {
    const nowMs = options?.before ? options.before.getTime() : Date.now();

    // Clean memory fallback
    for (const [key, mem] of this.memoryFallback.entries()) {
      if (mem.expiresAtMs && mem.expiresAtMs < nowMs) {
        if (!options?.keyPrefix || key.startsWith(options.keyPrefix)) {
          this.memoryFallback.delete(key);
        }
      }
    }

    if (!this.db) return 0;

    try {
      return await cleanExpiredLlmCache(this.db, options);
    } catch (err) {
      this.errorCount++;
      return 0;
    }
  }

  clear(): void {
    this.memoryFallback.clear();
  }
}

/**
 * Pure in-memory CacheStore for unit tests and isolated non-DB environments.
 */
export class InMemoryLlmCacheStore implements LlmCacheStore {
  private store = new Map<string, { entry: CacheEntry; expiresAtMs: number | null }>();
  public errorCount = 0;

  async get(key: string): Promise<CacheEntry | null> {
    const mem = this.store.get(key);
    if (!mem) return null;
    if (mem.expiresAtMs && mem.expiresAtMs < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return mem.entry;
  }

  async set(key: string, entry: CacheEntry, ttlMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
    const expiresAtMs = Date.now() + ttlMs;
    this.store.set(key, { entry, expiresAtMs });
  }

  async cleanExpired(options?: CleanExpiredOptions): Promise<number> {
    const nowMs = options?.before ? options.before.getTime() : Date.now();
    let count = 0;
    for (const [key, mem] of this.store.entries()) {
      if (mem.expiresAtMs && mem.expiresAtMs < nowMs) {
        if (!options?.keyPrefix || key.startsWith(options.keyPrefix)) {
          this.store.delete(key);
          count++;
        }
      }
    }
    return count;
  }

  clear(): void {
    this.store.clear();
  }
}
