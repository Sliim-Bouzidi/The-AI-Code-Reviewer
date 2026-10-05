import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
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

let cached: { row: LlmSettingsRow | null; at: number } | null = null;
const TTL_MS = 5_000;

export function clearLlmSettingsCache(): void {
  cached = null;
}

export async function getLlmSettingsRow(db: Db): Promise<LlmSettingsRow | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.row;
  const [row] = await db.select().from(llmSettings).where(eq(llmSettings.id, 'default'));
  cached = { row: row ?? null, at: Date.now() };
  return cached.row;
}

/**
 * The environment the LLM factory should use: process.env with every value saved from the dashboard
 * laid on top. So a key pasted in the dashboard wins over `.env`, and clearing it falls back to `.env`.
 */
export async function getLlmEnv(db: Db): Promise<NodeJS.ProcessEnv> {
  const row = await getLlmSettingsRow(db);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (row) {
    for (const [field, name] of Object.entries(LLM_SETTING_ENV)) {
      const value = row[field as LlmSettingField];
      if (value) env[name] = value;
    }
  }
  return env;
}
