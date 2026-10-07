import Anthropic from '@anthropic-ai/sdk';
import { LlmError } from './types.js';
import type { LlmCallInput, LlmCallResult, LlmProvider } from './types.js';

/** Models that support the server-side refusal fallback ("default" routing picks the substitute). */
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

/** The SDK's typed errors, mapped to ours so generateJson's retry/backoff applies. */
function toLlmError(err: unknown): LlmError {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    return new LlmError(`anthropic: HTTP ${status ?? '?'} ${err.message.slice(0, 300)}`, status, status === undefined || status === 429 || status >= 500);
  }
  return new LlmError(`anthropic: ${(err as Error).message}`, undefined, true);
}

/**
 * Claude, through the official Anthropic SDK (paid API key). No sampling parameters: current Claude
 * models reject `temperature`. On the newest models a classifier decline is retried server-side on
 * Anthropic's recommended model (`fallbacks: "default"`), so a review is not lost to a refusal.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(apiKey: string, readonly model: string) {
    // retries and backoff are handled by generateJson, like for the other providers
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async generate(input: LlmCallInput): Promise<LlmCallResult> {
    const fallback = FALLBACK_MODELS.test(this.model);
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: input.system,
        messages: [{ role: 'user', content: input.prompt }],
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
    } catch (err) {
      throw toLlmError(err);
    }
    if (response.stop_reason === 'refusal') {
      throw new LlmError(`anthropic: the model declined this request (${response.stop_details?.category ?? 'refusal'})`, undefined, false);
    }
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    if (!text) throw new LlmError('anthropic: empty response', undefined, false);
    return { text, tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens };
  }
}

/** Claude models this key can use (Models API), for the dashboard's model picker. */
export async function listAnthropicModels(apiKey: string): Promise<{ id: string; label: string }[]> {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const models: { id: string; label: string }[] = [];
  try {
    for await (const m of client.models.list()) models.push({ id: m.id, label: m.display_name });
  } catch (err) {
    throw toLlmError(err);
  }
  return models;
}
