import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJson, generateJson } from './generate-json.js';
import { LlmError } from './types.js';
import type { LlmProvider } from './types.js';

const fake = (name: string, answers: Array<string | Error>): LlmProvider & { calls: string[] } => {
  const calls: string[] = [];
  return {
    name,
    model: `${name}-model`,
    calls,
    async generate({ prompt }) {
      calls.push(prompt);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { text: next ?? '', tokensIn: 10, tokensOut: 5 };
    },
  };
};
const schema = z.object({ ok: z.boolean() });

describe('extractJson', () => {
  it('handles fences and surrounding text', () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(extractJson('Sure! {"ok":false} hope it helps')).toEqual({ ok: false });
  });
});

describe('generateJson', () => {
  it('retries once with the validation error', async () => {
    const p = fake('a', ['{"ok":"yes"}', '{"ok":true}']);
    const res = await generateJson([p], { system: 's', prompt: 'p', schema });
    expect(res.data).toEqual({ ok: true });
    expect(res.tokensIn).toBe(20);
    expect(p.calls[1]).toContain('rejected');
  });

  it('falls back to the next provider', async () => {
    const a = fake('a', [new LlmError('bad key', 401, false)]);
    const b = fake('b', ['{"ok":true}']);
    const res = await generateJson([a, b], { system: 's', prompt: 'p', schema });
    expect(res.provider).toBe('b');
  });

  it('backs off on rate limits', async () => {
    const a = fake('a', [new LlmError('429', 429, true), '{"ok":true}']);
    const res = await generateJson([a], { system: 's', prompt: 'p', schema, backoffMs: 1 });
    expect(res.data.ok).toBe(true);
  });

  it('does not retry when quota is exhausted and blocks fallback to paid provider', async () => {
    const freeProvider: LlmProvider & { calls: string[] } = {
      name: 'gemini-free',
      model: 'gemini-1.5-flash',
      isFree: true,
      calls: [],
      async generate({ prompt }) {
        this.calls.push(prompt);
        throw new LlmError('gemini: HTTP 429 RESOURCE_EXHAUSTED Quota exceeded', 429, false, true);
      },
    };

    const paidProvider: LlmProvider & { calls: string[] } = {
      name: 'anthropic-paid',
      model: 'claude-3-5-sonnet-20241022',
      isFree: false,
      calls: [],
      async generate({ prompt }) {
        this.calls.push(prompt);
        return { text: '{"ok":true}', tokensIn: 10, tokensOut: 5 };
      },
    };

    await expect(
      generateJson([freeProvider, paidProvider], {
        system: 's',
        prompt: 'p',
        schema,
        preventPaidFallbackOnQuota: true,
      })
    ).rejects.toThrow(/Quota exhausted for gemini-free.*Automatic fallback to paid provider anthropic-paid.*was blocked/);

    expect(freeProvider.calls.length).toBe(1); // No useless retries on quota exhaustion
    expect(paidProvider.calls.length).toBe(0); // Paid provider was never called!
  });
});
