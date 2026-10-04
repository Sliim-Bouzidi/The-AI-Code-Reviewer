import { GeminiEmbedder, GeminiProvider } from './gemini.js';
import { OpenRouterProvider } from './openrouter.js';
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

/**
 * Providers in priority order: LLM_PROVIDER/LLM_MODEL first, then the other provider as a
 * fallback when its key and LLM_FALLBACK_MODEL are set. Model names come from env only.
 */
export function createProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider[] {
  const primary = env.LLM_PROVIDER === 'openrouter' ? 'openrouter' : 'gemini';
  const make = (name: 'gemini' | 'openrouter', model: string | undefined): LlmProvider | null => {
    const key = name === 'gemini' ? env.GEMINI_API_KEY : env.OPENROUTER_API_KEY;
    if (!key || !model) return null;
    return name === 'gemini' ? new GeminiProvider(key, model) : new OpenRouterProvider(key, model);
  };
  const interval = Number(env.LLM_MIN_INTERVAL_MS ?? 4500);
  return [
    make(primary, env.LLM_MODEL),
    make(primary === 'gemini' ? 'openrouter' : 'gemini', env.LLM_FALLBACK_MODEL),
  ]
    .filter((p): p is LlmProvider => p !== null)
    .map((p) => throttled(p, interval));
}

/** null when embeddings are not configured: search and context retrieval are then skipped. */
export function createEmbedderFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  if (!env.GEMINI_API_KEY || !env.EMBEDDING_MODEL) return null;
  return new GeminiEmbedder(env.GEMINI_API_KEY, env.EMBEDDING_MODEL, Number(env.EMBEDDING_DIM ?? 768));
}
