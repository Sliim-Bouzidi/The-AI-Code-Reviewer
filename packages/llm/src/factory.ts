import { AnthropicProvider } from './anthropic.js';
import { GeminiEmbedder, GeminiProvider } from './gemini.js';
import { OpenAIEmbedder, OpenAIProvider } from './openai.js';
import { OpenAICompatibleProvider, OpenRouterProvider } from './openrouter.js';
import type { EmbeddingProvider, LlmCallInput, LlmProvider } from './types.js';

/**
 * Determines whether a provider and model pair operates on a verified free tier.
 * Never assumes a provider is free simply because a model is available.
 * OpenRouter models must end with ':free'. Gemini uses Google AI Studio free tier unless GEMINI_PAID is set.
 * Anthropic and OpenAI direct APIs are strictly paid.
 */
export function isFreeProvider(name: ProviderName, model?: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (name === 'gemini') {
    return env.GEMINI_PAID !== 'true';
  }
  if (name === 'openrouter') {
    // Only models with explicit ':free' slug or the official auto-router 'openrouter/free' are verified free
    return typeof model === 'string' && (model.endsWith(':free') || model === 'openrouter/free');
  }
  if (name === 'openai') {
    // OpenAI-compatible free hosts (Groq, Cerebras, NVIDIA NIM free tier)
    return Boolean(env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_API_KEY);
  }
  return false;
}

/** Spaces calls out so a free-tier requests-per-minute limit is not hit. */
export function throttled(provider: LlmProvider, minIntervalMs: number): LlmProvider {
  let next = 0;
  return {
    name: provider.name,
    model: provider.model,
    isFree: provider.isFree,
    async generate(input: LlmCallInput) {
      const wait = Math.max(0, next - Date.now());
      next = Math.max(Date.now(), next) + minIntervalMs;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      return provider.generate(input);
    },
  };
}

/**
 * Free tiers: gemini, openrouter, openai (= any OpenAI-compatible host: NIM, Groq, Cerebras, ...).
 * Paid: anthropic (Claude), openai-api (OpenAI's own API, GPT models).
 */
export type ProviderName = 'gemini' | 'openrouter' | 'openai' | 'anthropic' | 'openai-api';
export const PROVIDER_NAMES: readonly ProviderName[] = ['gemini', 'openrouter', 'openai', 'anthropic', 'openai-api'];

/** Builds one provider from env, or null when its key/model are missing. */
export function createProvider(name: ProviderName, model: string | undefined, env: NodeJS.ProcessEnv = process.env): LlmProvider | null {
  return make(env, name, model);
}

function make(env: NodeJS.ProcessEnv, name: ProviderName, model: string | undefined): LlmProvider | null {
  if (!model) return null;
  const isFree = isFreeProvider(name, model, env);
  let provider: LlmProvider | null = null;
  if (name === 'gemini') provider = env.GEMINI_API_KEY ? new GeminiProvider(env.GEMINI_API_KEY, model) : null;
  else if (name === 'openrouter') provider = env.OPENROUTER_API_KEY ? new OpenRouterProvider(env.OPENROUTER_API_KEY, model) : null;
  else if (name === 'anthropic') provider = env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY, model) : null;
  else if (name === 'openai-api') provider = env.OPENAI_API_KEY ? new OpenAIProvider(env.OPENAI_API_KEY, model) : null;
  else if (env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_API_KEY) {
    const label = env.OPENAI_COMPAT_NAME || new URL(env.OPENAI_COMPAT_BASE_URL).hostname.split('.').slice(-2, -1)[0] || 'openai';
    provider = new OpenAICompatibleProvider(label, env.OPENAI_COMPAT_BASE_URL, env.OPENAI_COMPAT_API_KEY, model);
  }
  if (provider) {
    return {
      name: provider.name,
      model: provider.model,
      isFree,
      generate: (input) => provider!.generate(input),
    };
  }
  return null;
}

const asProvider = (value: string | undefined): ProviderName | undefined =>
  PROVIDER_NAMES.includes(value as ProviderName) ? (value as ProviderName) : undefined;

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

/**
 * Resolves separate Economic (triage) and Powerful (deep analysis) provider tiers.
 * Economic tier uses LLM_PROVIDER_ECONOMIC & LLM_MODEL_ECONOMIC, prioritizing verified free tiers
 * (Gemini free tier, OpenRouter :free models, or OpenAI-compatible hosts).
 * Powerful tier uses LLM_PROVIDER_POWERFUL & LLM_MODEL_POWERFUL for deep analysis on escalated items.
 */
export function createTwoTierProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): {
  economic: LlmProvider[];
  powerful: LlmProvider[];
} {
  const interval = Number(env.LLM_MIN_INTERVAL_MS ?? 4500);

  // Economic tier: priority favors free providers
  let econName = asProvider(env.LLM_PROVIDER_ECONOMIC) ?? asProvider(env.LLM_PROVIDER);
  let econModel = env.LLM_MODEL_ECONOMIC ?? env.LLM_MODEL;

  if (!econName) {
    if (env.GEMINI_API_KEY) {
      econName = 'gemini';
      econModel = econModel ?? 'gemini-1.5-flash';
    } else if (env.OPENROUTER_API_KEY) {
      econName = 'openrouter';
      econModel = econModel ?? 'meta-llama/llama-3.3-70b-instruct:free';
    } else if (env.OPENAI_COMPAT_BASE_URL) {
      econName = 'openai';
    } else {
      econName = 'gemini';
    }
  }

  const econProvider = make(env, econName, econModel);

  const powName =
    asProvider(env.LLM_PROVIDER_POWERFUL) ??
    asProvider(env.LLM_FALLBACK_PROVIDER) ??
    asProvider(env.LLM_PROVIDER) ??
    'gemini';
  const powModel = env.LLM_MODEL_POWERFUL ?? env.LLM_FALLBACK_MODEL ?? env.LLM_MODEL ?? econModel;
  const powProvider = make(env, powName, powModel);

  const fallbackName = asProvider(env.LLM_FALLBACK_PROVIDER) ?? (econName === 'gemini' ? 'openrouter' : 'gemini');
  const fallbackProvider = make(env, fallbackName, env.LLM_FALLBACK_MODEL);

  const baseProviders = createProvidersFromEnv(env);

  const economicList = [econProvider, fallbackProvider].filter((p): p is LlmProvider => p !== null).map((p) => throttled(p, interval));
  const powerfulList = [powProvider, fallbackProvider].filter((p): p is LlmProvider => p !== null).map((p) => throttled(p, interval));

  return {
    economic: economicList.length > 0 ? economicList : baseProviders,
    powerful: powerfulList.length > 0 ? powerfulList : baseProviders,
  };
}

/** True when at least one chat provider is usable (shown by the dashboard's setup status). */
export function llmConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return createProvidersFromEnv(env).length > 0;
}

export type EmbeddingProviderName = 'gemini' | 'openai-api';
/** Used when OPENAI_EMBEDDING_MODEL is not set: cheap, and can return 768 dimensions. */
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Which embedding provider to use: EMBEDDING_PROVIDER when set, otherwise Gemini when its key and
 * EMBEDDING_MODEL are there (free), otherwise OpenAI when its key is (paid). Claude has no
 * embedding model. null = not configured: indexing, search and review context are unavailable.
 */
export function resolveEmbeddingProvider(env: NodeJS.ProcessEnv = process.env): EmbeddingProviderName | null {
  const gemini = !!(env.GEMINI_API_KEY && env.EMBEDDING_MODEL);
  const openai = !!env.OPENAI_API_KEY;
  if (env.EMBEDDING_PROVIDER === 'gemini') return gemini ? 'gemini' : null;
  if (env.EMBEDDING_PROVIDER === 'openai-api') return openai ? 'openai-api' : null;
  return gemini ? 'gemini' : openai ? 'openai-api' : null;
}

/** null when embeddings are not configured: search and context retrieval are then skipped. */
export function createEmbedderFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  const dim = Number(env.EMBEDDING_DIM ?? 768);
  const provider = resolveEmbeddingProvider(env);
  if (provider === 'gemini') return new GeminiEmbedder(env.GEMINI_API_KEY!, env.EMBEDDING_MODEL!, dim);
  if (provider === 'openai-api') {
    return new OpenAIEmbedder(env.OPENAI_API_KEY!, env.OPENAI_EMBEDDING_MODEL || DEFAULT_OPENAI_EMBEDDING_MODEL, dim);
  }
  return null;
}

/** Identifies the vectors an embedder produces: an index built by one cannot be searched by another. */
export function embedderId(embedder: EmbeddingProvider): string {
  return `${embedder.name}:${embedder.model}`;
}
