import { httpJson, LlmError } from './types.js';
import type { EmbeddingProvider, LlmCallInput, LlmCallResult, LlmProvider } from './types.js';

/** GEMINI_BASE_URL is only for tests/proxies; the default is the public API. */
const base = () => process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generate(input: LlmCallInput): Promise<LlmCallResult> {
    const data = await httpJson(
      `${base()}/models/${this.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
          generationConfig: {
            temperature: input.temperature ?? 0.2,
            ...(input.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      },
      'gemini',
    );
    const text: string = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '')
      .join('');
    if (!text) throw new LlmError('gemini: empty response', undefined, false);
    return {
      text,
      tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Batch size and the pause between batches; free-tier keys allow only so many embeddings per minute. */
const EMBED_BATCH = Number(process.env.EMBED_BATCH_SIZE ?? 20);
const EMBED_INTERVAL_MS = Number(process.env.EMBED_MIN_INTERVAL_MS ?? 1_000);
const EMBED_MAX_WAITS = 8;
/** Longer suggested waits mean a daily quota, not a per-minute one. */
const MAX_WAIT_MS = 2 * 60_000;

/** Gemini's 429 body says how long to wait ("retryDelay": "37s"); default to a minute. */
function retryDelayMs(err: LlmError): number {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(err.message);
  return (m ? Number(m[1]) : 60) * 1_000 + 1_000;
}

export class GeminiEmbedder implements EmbeddingProvider {
  readonly name = 'gemini';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    readonly dim: number,
  ) {}

  /**
   * Embeds in small batches. A rate limit (429) is waited out and the same batch retried, so
   * indexing a whole repo on a free key is slow but finishes instead of failing on the first burst.
   */
  async embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      if (i > 0) await sleep(EMBED_INTERVAL_MS);
      const batch = texts.slice(i, i + EMBED_BATCH);
      for (let wait = 0; ; wait++) {
        try {
          const data = await httpJson(
            `${base()}/models/${this.model}:batchEmbedContents`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
              body: JSON.stringify({
                requests: batch.map((text) => ({
                  model: `models/${this.model}`,
                  content: { parts: [{ text }] },
                  taskType: kind === 'query' ? 'CODE_RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
                  outputDimensionality: this.dim,
                })),
              }),
            },
            'gemini-embed',
          );
          for (const e of data.embeddings ?? []) out.push(e.values as number[]);
          break;
        } catch (err) {
          if (!(err instanceof LlmError) || err.status !== 429 || wait >= EMBED_MAX_WAITS) throw err;
          const delay = retryDelayMs(err);
          // a per-minute limit says "retry in ~40s"; a used-up daily quota says "retry in 13h": give up
          if (delay > MAX_WAIT_MS) {
            throw new LlmError(
              `gemini-embed: HTTP 429 daily free-tier embedding quota used up (retry in ${Math.round(delay / 3_600_000)}h)`,
              429,
              false,
            );
          }
          await sleep(delay);
        }
      }
    }
    if (out.length !== texts.length) throw new LlmError('gemini-embed: wrong number of embeddings');
    return out;
  }
}
