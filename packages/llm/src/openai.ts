import { OpenAICompatibleProvider } from './openrouter.js';
import { httpJson, LlmError } from './types.js';
import type { EmbeddingProvider } from './types.js';

export const OPENAI_BASE = 'https://api.openai.com/v1';

/** OpenAI's own API (GPT models, paid key). Same chat format as the free OpenAI-compatible hosts. */
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, model: string) {
    // GPT-5 / o-series reasoning models only accept the default temperature
    super('openai', OPENAI_BASE, apiKey, model, false);
  }
}

const BATCH = 96;

/**
 * OpenAI embeddings (text-embedding-3-*), asked for exactly `dim` numbers so the vectors fit the
 * same vector(768) column as Gemini's. Paid; the alternative for users without a Gemini key.
 */
export class OpenAIEmbedder implements EmbeddingProvider {
  readonly name = 'openai';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    readonly dim: number,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const data = await httpJson(
        `${OPENAI_BASE}/embeddings`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ model: this.model, input: texts.slice(i, i + BATCH), dimensions: this.dim }),
        },
        'openai-embed',
      );
      const rows = ((data.data ?? []) as { index: number; embedding: number[] }[]).sort((a, b) => a.index - b.index);
      out.push(...rows.map((r) => r.embedding));
    }
    if (out.length !== texts.length) throw new LlmError('openai-embed: wrong number of embeddings');
    return out;
  }
}
