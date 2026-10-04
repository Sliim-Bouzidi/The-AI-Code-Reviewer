import type { z } from 'zod';
import { LlmError } from './types.js';
import type { LlmProvider } from './types.js';

export interface GenerateJsonResult<T> {
  data: T;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** Pulls the first JSON object/array out of a model answer (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[{[]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start === -1 || end <= start) throw new Error('No JSON found in the answer');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The one entry point business code uses.
 * Per provider: retry rate limits / 5xx with backoff, validate the answer with Zod and, if it is
 * malformed, retry once with the validation error in the prompt. If a provider still fails, the
 * next one in the list is tried (e.g. Gemini -> OpenRouter).
 */
export async function generateJson<S extends z.ZodTypeAny>(
  providers: LlmProvider[],
  input: { system: string; prompt: string; schema: S; backoffMs?: number },
): Promise<GenerateJsonResult<z.infer<S>>> {
  if (providers.length === 0) throw new LlmError('No LLM provider configured');
  let lastError: unknown;
  for (const provider of providers) {
    let tokensIn = 0;
    let tokensOut = 0;
    let prompt = input.prompt;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await callWithBackoff(provider, input.system, prompt, input.backoffMs ?? 5_000);
        tokensIn += res.tokensIn;
        tokensOut += res.tokensOut;
        let problem: string;
        try {
          const parsed = input.schema.safeParse(extractJson(res.text));
          if (parsed.success) {
            return { data: parsed.data, provider: provider.name, model: provider.model, tokensIn, tokensOut };
          }
          problem = JSON.stringify(parsed.error.issues.slice(0, 10));
        } catch (err) {
          problem = (err as Error).message;
        }
        lastError = new LlmError(`${provider.name}: invalid structured output: ${problem}`);
        prompt =
          `${input.prompt}\n\nYour previous answer was rejected: ${problem}\n` +
          'Answer again with ONLY valid JSON that matches the schema exactly.';
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function callWithBackoff(provider: LlmProvider, system: string, prompt: string, backoffMs: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.generate({ system, prompt, json: true });
    } catch (err) {
      if (!(err instanceof LlmError) || !err.retryable || attempt >= 2) throw err;
      await sleep(backoffMs * 2 ** attempt);
    }
  }
}
