import { httpJson, LlmError } from './types.js';
import type { LlmCallInput, LlmCallResult, LlmProvider } from './types.js';

/** OpenRouter speaks the OpenAI chat-completions format. */
export class OpenRouterProvider implements LlmProvider {
  readonly name = 'openrouter';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generate(input: LlmCallInput): Promise<LlmCallResult> {
    const data = await httpJson(
      'https://openrouter.ai/api/v1/chat/completions',
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
      'openrouter',
    );
    const text: string = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw new LlmError('openrouter: empty response', undefined, false);
    return {
      text,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}
