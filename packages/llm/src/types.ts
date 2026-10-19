export interface LlmCallInput {
  system: string;
  prompt: string;
  /** Ask the provider for a JSON-only answer when it supports it. */
  json?: boolean;
  temperature?: number;
  /** Maximum number of tokens to generate in response */
  maxOutputTokens?: number;
  /** Optional cancellation signal to interrupt HTTP transport */
  signal?: AbortSignal;
}

export interface LlmCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly isFree?: boolean;
  generate(input: LlmCallInput): Promise<LlmCallResult>;
}

export interface EmbeddingProvider {
  readonly name: string; // 'gemini' | 'openai'
  readonly model: string;
  readonly dim: number;
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
}

/** Determines whether an HTTP error status and body represent an exhausted quota rather than a transient rate limit. */
export function isQuotaExhaustedError(status?: number, body?: string): boolean {
  if (status === 402) return true; // Payment required / out of credits
  if (status === 429 && body) {
    const lower = body.toLowerCase();
    return (
      lower.includes('resource_exhausted') ||
      lower.includes('insufficient_quota') ||
      lower.includes('exceeded your current quota') ||
      lower.includes('insufficient_credits') ||
      lower.includes('out of credits') ||
      lower.includes('daily limit') ||
      lower.includes('quota exceeded') ||
      lower.includes('quota metric') ||
      lower.includes('queries per day') ||
      lower.includes('credit balance') ||
      lower.includes('billing')
    );
  }
  return false;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** true for rate limits and server errors: worth waiting and trying again */
    readonly retryable = false,
    /** true when a provider's free or paid budget quota is completely exhausted */
    readonly isQuotaExhausted = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export async function httpJson(url: string, init: RequestInit, label: string): Promise<any> {
  let res: Response;
  const timeoutSignal = AbortSignal.timeout(120_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError' || init.signal?.aborted) {
      throw new LlmError(`${label}: request aborted`, undefined, false);
    }
    throw new LlmError(`${label}: network error (${(err as Error).message})`, undefined, true);
  }
  if (!res.ok) {
    const full = await res.text();
    // keep the provider's suggested wait (it sits at the end of long 429 bodies) after truncating
    const delay = /"retryDelay"\s*:\s*"[\d.]+s"/.exec(full)?.[0];
    const body = full.slice(0, 300) + (delay && !full.slice(0, 300).includes(delay) ? ` ${delay}` : '');
    const quotaExhausted = isQuotaExhaustedError(res.status, full);
    const retryable = !quotaExhausted && (res.status === 429 || res.status >= 500);
    throw new LlmError(`${label}: HTTP ${res.status} ${body}`, res.status, retryable, quotaExhausted);
  }
  return res.json();
}
