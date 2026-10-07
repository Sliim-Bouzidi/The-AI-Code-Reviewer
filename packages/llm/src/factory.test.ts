import { describe, expect, it } from 'vitest';
import { createEmbedderFromEnv, createProvidersFromEnv, embedderId, llmConfigured, resolveEmbeddingProvider, resolveProviders } from './factory.js';

const names = (env: NodeJS.ProcessEnv) => createProvidersFromEnv(env).map((p) => `${p.name}:${p.model}`);

describe('createProvidersFromEnv', () => {
  it('keeps the original gemini -> openrouter order by default', () => {
    expect(
      names({ GEMINI_API_KEY: 'g', LLM_MODEL: 'gem', OPENROUTER_API_KEY: 'o', LLM_FALLBACK_MODEL: 'or-model' }),
    ).toEqual(['gemini:gem', 'openrouter:or-model']);
  });

  it('uses any OpenAI-compatible endpoint as the primary, labelled by its host', () => {
    expect(
      names({
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'z-ai/glm-5.3',
        OPENAI_COMPAT_BASE_URL: 'https://integrate.api.nvidia.com/v1',
        OPENAI_COMPAT_API_KEY: 'nv',
      }),
    ).toEqual(['nvidia:z-ai/glm-5.3']);
  });

  it('can fall back to gemini from an OpenAI-compatible primary', () => {
    expect(
      names({
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'llama',
        OPENAI_COMPAT_BASE_URL: 'https://api.groq.com/openai/v1',
        OPENAI_COMPAT_API_KEY: 'gq',
        LLM_FALLBACK_PROVIDER: 'gemini',
        LLM_FALLBACK_MODEL: 'gem',
        GEMINI_API_KEY: 'g',
      }),
    ).toEqual(['groq:llama', 'gemini:gem']);
  });

  it('skips providers whose key or model is missing', () => {
    expect(names({ LLM_PROVIDER: 'openai', LLM_MODEL: 'm' })).toEqual([]);
    expect(llmConfigured({})).toBe(false);
    expect(llmConfigured({ GEMINI_API_KEY: 'g', LLM_MODEL: 'gem' })).toBe(true);
  });
});

describe('paid providers and embedding choice', () => {
  it('builds Claude and OpenAI (GPT) providers from their own keys', () => {
    const env = { LLM_PROVIDER: 'anthropic', LLM_MODEL: 'claude-opus-5-5', ANTHROPIC_API_KEY: 'a', LLM_FALLBACK_PROVIDER: 'openai-api', LLM_FALLBACK_MODEL: 'gpt-x', OPENAI_API_KEY: 'o' };
    const { primary, fallback } = resolveProviders(env);
    expect(primary?.name).toBe('anthropic');
    expect(fallback?.name).toBe('openai');
    expect(resolveProviders({ ...env, ANTHROPIC_API_KEY: '' }).primary).toBeNull();
  });

  it('prefers free Gemini embeddings, falls back to OpenAI, and never uses Claude', () => {
    expect(resolveEmbeddingProvider({ GEMINI_API_KEY: 'g', EMBEDDING_MODEL: 'gemini-embedding-001', OPENAI_API_KEY: 'o' })).toBe('gemini');
    expect(resolveEmbeddingProvider({ OPENAI_API_KEY: 'o', EMBEDDING_MODEL: 'gemini-embedding-001' })).toBe('openai-api');
    expect(resolveEmbeddingProvider({ ANTHROPIC_API_KEY: 'a' })).toBeNull();
    expect(resolveEmbeddingProvider({ EMBEDDING_PROVIDER: 'openai-api', GEMINI_API_KEY: 'g', EMBEDDING_MODEL: 'm' })).toBeNull();
  });

  it('identifies an index by provider and model', () => {
    const e = createEmbedderFromEnv({ OPENAI_API_KEY: 'o' })!;
    expect(embedderId(e)).toBe('openai:text-embedding-3-small');
    expect(e.dim).toBe(768);
  });
});
