import { mergeLlmEnv } from '@codereview/db';
import { describe, expect, it } from 'vitest';

const base = { GEMINI_API_KEY: 'server-gemini', OPENROUTER_API_KEY: 'server-or', LLM_PROVIDER: 'gemini', LLM_MODEL: 'flash' };

describe('mergeLlmEnv (per-user AI settings)', () => {
  it('hides the server keys from a user who may not use them, but keeps the model defaults', () => {
    const env = mergeLlmEnv(base, null, false);
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.LLM_MODEL).toBe('flash');
  });

  it("uses the user's own key and model over the defaults", () => {
    const env = mergeLlmEnv(base, { geminiApiKey: 'user-gemini', llmModel: 'pro', openrouterApiKey: null }, false);
    expect(env.GEMINI_API_KEY).toBe('user-gemini');
    expect(env.LLM_MODEL).toBe('pro');
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it('keeps the server keys for the admin (or a shared install)', () => {
    const env = mergeLlmEnv(base, { llmModel: 'pro' }, true);
    expect(env.GEMINI_API_KEY).toBe('server-gemini');
    expect(env.LLM_MODEL).toBe('pro');
  });

  it('never changes the base env', () => {
    mergeLlmEnv(base, { geminiApiKey: 'x' }, false);
    expect(base.GEMINI_API_KEY).toBe('server-gemini');
  });
});
