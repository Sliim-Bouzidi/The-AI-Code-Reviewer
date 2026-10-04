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

export class GeminiEmbedder implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    readonly dim: number,
  ) {}

  async embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 50) {
      const batch = texts.slice(i, i + 50);
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
    }
    if (out.length !== texts.length) throw new LlmError('gemini-embed: wrong number of embeddings');
    return out;
  }
}
