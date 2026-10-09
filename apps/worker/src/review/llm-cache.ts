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

export interface LlmCacheStore {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry, ttlMs?: number): Promise<void>;
  clear?(): void;
}

/** Default TTL for cache entries: 30 days in milliseconds */
export const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Persistent DB-backed LLM Cache store with automatic in-memory fallback.
 * Uses PostgreSQL `@codereview/db` `llmCache` table with atomic upserts.
 */
export class DbLlmCacheStore implements LlmCacheStore {
  private memoryFallback = new Map<string, { entry: CacheEntry; expiresAtMs: number | null }>();
  public errorCount = 0;

  constructor(private db?: Db | null) {}

  async get(key: string): Promise<CacheEntry | null> {
    const nowMs = Date.now();

    // 1. Try DB read if DB is available
    if (this.db) {
      try {
        const [row] = await this.db.select().from(llmCache).where(eq(llmCache.cacheKey, key));
        if (row) {
          if (row.expiresAt && new Date(row.expiresAt).getTime() < nowMs) {
            // Expired entry
            return null;
          }

          const rawData = row.data as any;
          if (rawData && SemgrepDecisionStateSchema.safeParse(rawData.decision).success) {
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

  clear(): void {
    this.store.clear();
  }
}
