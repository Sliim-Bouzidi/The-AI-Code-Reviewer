import { describe, expect, it } from 'vitest';
import { createProvidersFromEnv, llmConfigured } from './factory.js';

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
