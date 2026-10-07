import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { isGithubAppAdmin } from './github-app.js';
import { llmSettings } from './schema.js';

/** Dashboard column -> the env var it overrides. */
export const LLM_SETTING_ENV = {
  geminiApiKey: 'GEMINI_API_KEY',
  openrouterApiKey: 'OPENROUTER_API_KEY',
  openaiCompatBaseUrl: 'OPENAI_COMPAT_BASE_URL',
  openaiCompatApiKey: 'OPENAI_COMPAT_API_KEY',
  llmProvider: 'LLM_PROVIDER',
  llmModel: 'LLM_MODEL',
  llmFallbackProvider: 'LLM_FALLBACK_PROVIDER',
  llmFallbackModel: 'LLM_FALLBACK_MODEL',
  embeddingModel: 'EMBEDDING_MODEL',
} as const;

export type LlmSettingField = keyof typeof LLM_SETTING_ENV;
export type LlmSettingsRow = typeof llmSettings.$inferSelect;
type SettingsValues = Partial<Record<LlmSettingField, string | null>>;

/** The secret fields: the server's env values for these are never handed to other users unless shared. */
export const LLM_KEY_FIELDS = ['geminiApiKey', 'openrouterApiKey', 'openaiCompatApiKey'] as const satisfies readonly LlmSettingField[];

/**
 * The AI keys in the server's env serve only the GitHub App admin (who created the app, usually the
 * person running the install); every other user brings their own keys on the dashboard. Secure by
 * default: SHARED_LLM_KEYS=true hands the env keys to every signed-in user (trusted team only).
 */
export function sharedLlmKeys(): boolean {
  return process.env.SHARED_LLM_KEYS === 'true';
}

/**
 * Pure merge: process env (models, defaults) with the user's saved values on top. When the env keys
 * may not be used, they are removed first, so a user without keys gets "not configured", never ours.
 */
export function mergeLlmEnv(base: NodeJS.ProcessEnv, row: SettingsValues | null, useEnvKeys: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  if (!useEnvKeys) for (const field of LLM_KEY_FIELDS) delete env[LLM_SETTING_ENV[field]];
  if (row) {
    for (const [field, name] of Object.entries(LLM_SETTING_ENV)) {
      const value = row[field as LlmSettingField];
      if (value) env[name] = value;
    }
  }
  return env;
}

const cache = new Map<string, { row: LlmSettingsRow | null; at: number }>();
const TTL_MS = 5_000;

export function clearLlmSettingsCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export async function getLlmSettingsRow(db: Db, userId: string | null): Promise<LlmSettingsRow | null> {
  if (!userId) return null;
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
  const [row] = await db.select().from(llmSettings).where(eq(llmSettings.userId, userId));
  cache.set(userId, { row: row ?? null, at: Date.now() });
  return row ?? null;
}

/** May this user's AI calls fall back to the keys in the server's env? */
export async function canUseEnvLlmKeys(db: Db, userId: string | null): Promise<boolean> {
  return sharedLlmKeys() || (await isGithubAppAdmin(db, userId));
}

/**
 * The environment the LLM factory should use for one user's work (their reviews, indexing, evals,
 * search): their dashboard values over the env defaults. `userId` null = nobody's settings.
 */
export async function getLlmEnv(db: Db, userId: string | null): Promise<NodeJS.ProcessEnv> {
  const [row, useEnvKeys] = await Promise.all([getLlmSettingsRow(db, userId), canUseEnvLlmKeys(db, userId)]);
  return mergeLlmEnv(process.env, row, useEnvKeys);
}
