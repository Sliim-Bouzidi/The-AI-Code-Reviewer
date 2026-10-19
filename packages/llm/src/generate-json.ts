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

export interface GenerateJsonInput<S extends z.ZodTypeAny> {
  system: string;
  prompt: string;
  schema: S;
  backoffMs?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /** When true (default), prevents cascading to a paid provider if a free provider exhausted its quota. */
  preventPaidFallbackOnQuota?: boolean;
}

/**
 * The one entry point business code uses.
 * Per provider: retry rate limits / 5xx with backoff, validate the answer with Zod and, if it is
 * malformed, retry once with the validation error in the prompt. If a provider still fails, the
 * next one in the list is tried (e.g. Gemini -> OpenRouter).
 * Blocks automatic transition to paid providers when a free tier quota is exhausted.
 */
export async function generateJson<S extends z.ZodTypeAny>(
  providers: LlmProvider[],
  input: GenerateJsonInput<S>,
): Promise<GenerateJsonResult<z.infer<S>>> {
  if (providers.length === 0) throw new LlmError('No LLM provider configured');
  let lastError: unknown;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    if (input.signal?.aborted) {
      throw new LlmError('Operation aborted by signal', undefined, false);
    }
    let tokensIn = 0;
    let tokensOut = 0;
    let prompt = input.prompt;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (input.signal?.aborted) {
          throw new LlmError('Operation aborted by signal', undefined, false);
        }
        const res = await callWithBackoff(
          provider,
          input.system,
          prompt,
          input.backoffMs ?? 5_000,
          input.maxOutputTokens,
          input.signal,
        );
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
      if (input.signal?.aborted) {
        throw lastError;
      }
      // Quota Protection: if this provider failed due to exhausted quota, block fallback to paid API
      if (
        err instanceof LlmError &&
        err.isQuotaExhausted &&
        input.preventPaidFallbackOnQuota !== false
      ) {
        const nextProvider = providers[i + 1];
        if (nextProvider && nextProvider.isFree === false) {
          throw new LlmError(
            `Quota exhausted for ${provider.name} (${provider.model}). Automatic fallback to paid provider ${nextProvider.name} (${nextProvider.model}) was blocked to prevent unexpected billing.`,
            err.status,
            false,
            true,
          );
        }
      }
    }
  }
  throw lastError;
}

async function callWithBackoff(
  provider: LlmProvider,
  system: string,
  prompt: string,
  backoffMs: number,
  maxOutputTokens?: number,
  signal?: AbortSignal,
) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) {
      throw new LlmError('Operation aborted by signal', undefined, false);
    }
    try {
      return await provider.generate({ system, prompt, json: true, maxOutputTokens, signal });
    } catch (err) {
      if (
        signal?.aborted ||
        !(err instanceof LlmError) ||
        !err.retryable ||
        err.isQuotaExhausted ||
        attempt >= 2
      ) {
        throw err;
      }
      await sleep(backoffMs * 2 ** attempt);
      if (signal?.aborted) {
        throw new LlmError('Operation aborted by signal', undefined, false);
      }
    }
  }
}
