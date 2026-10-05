import { httpJson } from './types.js';
import type { ProviderName } from './factory.js';

export interface ModelInfo {
  id: string; // exact name to put in LLM_MODEL / EMBEDDING_MODEL
  label?: string; // human name when the provider gives one
  free?: boolean; // known to be free (OpenRouter ":free" or zero price)
}

export type ModelKind = 'chat' | 'embedding';

const geminiBase = () => process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';
/** Ids that are clearly not chat models on OpenAI-compatible hosts (audio, safety, rerank, ...). */
const NOT_CHAT = /whisper|tts|speech|transcri|orpheus|guard|safety|rerank|moderation|embed|clip|image-gen|diffusion/i;

/**
 * Asks a provider which models this key can use, so the dashboard can offer a list instead of
 * making the user guess names. Uses the same env as the factory (dashboard values over .env).
 * Throws with a readable message when the key/base URL is missing or the provider refuses.
 */
export async function listModels(env: NodeJS.ProcessEnv, provider: ProviderName, kind: ModelKind): Promise<ModelInfo[]> {
  let models: ModelInfo[];
  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('Save a Gemini key first.');
    const data = await httpJson(
      `${geminiBase()}/models?pageSize=1000`,
      { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } },
      'gemini',
    );
    const method = kind === 'embedding' ? 'embedContent' : 'generateContent';
    models = ((data.models ?? []) as { name: string; displayName?: string; supportedGenerationMethods?: string[] }[])
      .filter((m) => m.supportedGenerationMethods?.includes(method))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName }));
  } else if (provider === 'openrouter') {
    if (kind === 'embedding') return [];
    // public list, no key needed
    const data = await httpJson('https://openrouter.ai/api/v1/models', {}, 'openrouter');
    models = ((data.data ?? []) as { id: string; name?: string; pricing?: { prompt?: string; completion?: string } }[]).map((m) => ({
      id: m.id,
      label: m.name,
      free: m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0'),
    }));
  } else {
    if (kind === 'embedding') return [];
    if (!env.OPENAI_COMPAT_BASE_URL || !env.OPENAI_COMPAT_API_KEY) throw new Error('Save the base URL and its API key first.');
    const data = await httpJson(
      `${env.OPENAI_COMPAT_BASE_URL.replace(/\/$/, '')}/models`,
      { headers: { authorization: `Bearer ${env.OPENAI_COMPAT_API_KEY}` } },
      'models',
    );
    models = ((data.data ?? []) as { id: string }[]).filter((m) => !NOT_CHAT.test(m.id)).map((m) => ({ id: m.id }));
  }
  // free first, then alphabetical; no duplicates
  const seen = new Set<string>();
  return models
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => Number(!!b.free) - Number(!!a.free) || a.id.localeCompare(b.id));
}
