import { httpJson, LlmError } from './types.js';
import type { LlmCallInput, LlmCallResult, LlmProvider } from './types.js';

/**
 * Any provider that speaks the OpenAI chat-completions format: NVIDIA NIM, Groq, Cerebras, Mistral,
 * OpenRouter, ... (most free tiers listed on freellm.net). Only the base URL, key and model differ.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generate(input: LlmCallInput): Promise<LlmCallResult> {
    const data = await httpJson(
      `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature: input.temperature ?? 0.2,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.prompt },
          ],
        }),
      },
      this.name,
    );
    const text: string = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw new LlmError(`${this.name}: empty response`, undefined, false);
    return {
      text,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}

/** OpenRouter is one of them, with a fixed base URL. */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, model: string) {
    super('openrouter', 'https://openrouter.ai/api/v1', apiKey, model);
  }
}
