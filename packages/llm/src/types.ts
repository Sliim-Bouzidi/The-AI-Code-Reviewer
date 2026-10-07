export interface LlmCallInput {
  system: string;
  prompt: string;
  /** Ask the provider for a JSON-only answer when it supports it. */
  json?: boolean;
  temperature?: number;
}

export interface LlmCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(input: LlmCallInput): Promise<LlmCallResult>;
}

export interface EmbeddingProvider {
  readonly name: string; // 'gemini' | 'openai'
  readonly model: string;
  readonly dim: number;
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** true for rate limits and server errors: worth waiting and trying again */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export async function httpJson(url: string, init: RequestInit, label: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    throw new LlmError(`${label}: network error (${(err as Error).message})`, undefined, true);
  }
  if (!res.ok) {
    const full = await res.text();
    // keep the provider's suggested wait (it sits at the end of long 429 bodies) after truncating
    const delay = /"retryDelay"\s*:\s*"[\d.]+s"/.exec(full)?.[0];
    const body = full.slice(0, 300) + (delay && !full.slice(0, 300).includes(delay) ? ` ${delay}` : '');
    throw new LlmError(`${label}: HTTP ${res.status} ${body}`, res.status, res.status === 429 || res.status >= 500);
  }
  return res.json();
}
