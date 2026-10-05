import { GeminiEmbedder, GeminiProvider } from './gemini.js';
import { OpenAICompatibleProvider, OpenRouterProvider } from './openrouter.js';
import type { EmbeddingProvider, LlmCallInput, LlmProvider } from './types.js';

/** Spaces calls out so a free-tier requests-per-minute limit is not hit. */
export function throttled(provider: LlmProvider, minIntervalMs: number): LlmProvider {
  let next = 0;
  return {
    name: provider.name,
    model: provider.model,
    async generate(input: LlmCallInput) {
      const wait = Math.max(0, next - Date.now());
      next = Math.max(Date.now(), next) + minIntervalMs;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      return provider.generate(input);
    },
  };
}

export type ProviderName = 'gemini' | 'openrouter' | 'openai';

/** Builds one provider from env, or null when its key/model are missing. */
function make(env: NodeJS.ProcessEnv, name: ProviderName, model: string | undefined): LlmProvider | null {
  if (!model) return null;
  if (name === 'gemini') return env.GEMINI_API_KEY ? new GeminiProvider(env.GEMINI_API_KEY, model) : null;
  if (name === 'openrouter') return env.OPENROUTER_API_KEY ? new OpenRouterProvider(env.OPENROUTER_API_KEY, model) : null;
  // any OpenAI-compatible endpoint: NVIDIA NIM, Groq, Cerebras, ... (label taken from the host)
  if (!env.OPENAI_COMPAT_BASE_URL || !env.OPENAI_COMPAT_API_KEY) return null;
  const label = env.OPENAI_COMPAT_NAME || new URL(env.OPENAI_COMPAT_BASE_URL).hostname.split('.').slice(-2, -1)[0] || 'openai';
  return new OpenAICompatibleProvider(label, env.OPENAI_COMPAT_BASE_URL, env.OPENAI_COMPAT_API_KEY, model);
}

const asProvider = (value: string | undefined): ProviderName | undefined =>
  value === 'gemini' || value === 'openrouter' || value === 'openai' ? value : undefined;

/**
 * Providers in priority order: LLM_PROVIDER + LLM_MODEL first, then LLM_FALLBACK_PROVIDER +
 * LLM_FALLBACK_MODEL. Without LLM_FALLBACK_PROVIDER the fallback is the "other" of gemini/openrouter
 * (the original behaviour). Model names come from env only.
 */
export function createProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider[] {
  const { primary, fallback } = resolveProviders(env);
  const interval = Number(env.LLM_MIN_INTERVAL_MS ?? 4500);
  return [primary, fallback].filter((p): p is LlmProvider => p !== null).map((p) => throttled(p, interval));
}

/** The primary and fallback slots separately (null = not usable), e.g. for the dashboard's status page. */
export function resolveProviders(env: NodeJS.ProcessEnv = process.env): {
  primary: LlmProvider | null;
  fallback: LlmProvider | null;
} {
  const primary = asProvider(env.LLM_PROVIDER) ?? 'gemini';
  const fallback = asProvider(env.LLM_FALLBACK_PROVIDER) ?? (primary === 'gemini' ? 'openrouter' : 'gemini');
  return { primary: make(env, primary, env.LLM_MODEL), fallback: make(env, fallback, env.LLM_FALLBACK_MODEL) };
}

/** True when at least one chat provider is usable (shown by the dashboard's setup status). */
export function llmConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return createProvidersFromEnv(env).length > 0;
}

/** null when embeddings are not configured: search and context retrieval are then skipped. */
export function createEmbedderFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  if (!env.GEMINI_API_KEY || !env.EMBEDDING_MODEL) return null;
  return new GeminiEmbedder(env.GEMINI_API_KEY, env.EMBEDDING_MODEL, Number(env.EMBEDDING_DIM ?? 768));
}
