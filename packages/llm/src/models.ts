import { listAnthropicModels } from './anthropic.js';
import { OPENAI_BASE } from './openai.js';
import { httpJson } from './types.js';
import type { ProviderName } from './factory.js';

export interface ModelInfo {
  id: string; // exact name to put in LLM_MODEL / EMBEDDING_MODEL
  label?: string; // human name when the provider gives one
  free?: boolean; // usable on a free tier (OpenRouter ":free"/zero price, Gemini's free-tier models)
}

export type ModelKind = 'chat' | 'embedding';

const geminiBase = () => process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';
/** Ids that are clearly not chat models on OpenAI-compatible hosts (audio, safety, rerank, ...). */
const NOT_CHAT = /whisper|tts|speech|transcri|orpheus|guard|safety|rerank|moderation|embed|clip|image-gen|diffusion/i;
/** Gemini's free tier covers the Flash / Flash-Lite and Gemma models (Pro needs billing). */
const GEMINI_FREE = /flash|gemma/i;
const GEMINI_NOT_TEXT = /image|tts|audio|live|robotics|computer-use|transcribe|deep-research|antigravity/i;
/** OpenAI ids that are not text chat models (audio, realtime, images, search previews, ...). */
const OPENAI_NOT_CHAT = /audio|realtime|transcribe|tts|image|search|instruct|davinci|babbage|codex-mini|moderation|embedding|whisper|dall-e/i;

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
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName }))
      .filter((m) => kind === 'embedding' || !GEMINI_NOT_TEXT.test(m.id))
      .map((m) => ({ ...m, free: kind === 'embedding' || GEMINI_FREE.test(m.id) }));
  } else if (provider === 'openrouter') {
    if (kind === 'embedding') return [];
    // public list, no key needed
    const data = await httpJson('https://openrouter.ai/api/v1/models', {}, 'openrouter');
    models = ((data.data ?? []) as { id: string; name?: string; pricing?: { prompt?: string; completion?: string } }[]).map((m) => ({
      id: m.id,
      label: m.name,
      free: m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0'),
    }));
  } else if (provider === 'anthropic') {
    if (kind === 'embedding') return []; // Claude has no embedding model
    if (!env.ANTHROPIC_API_KEY) throw new Error('Save an Anthropic key first.');
    models = await listAnthropicModels(env.ANTHROPIC_API_KEY);
  } else if (provider === 'openai-api') {
    if (!env.OPENAI_API_KEY) throw new Error('Save an OpenAI key first.');
    const data = await httpJson(`${OPENAI_BASE}/models`, { headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` } }, 'openai');
    const ids = ((data.data ?? []) as { id: string }[]).map((m) => m.id);
    models = (kind === 'embedding'
      ? ids.filter((id) => id.startsWith('text-embedding-3'))
      : ids.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !OPENAI_NOT_CHAT.test(id))
    ).map((id) => ({ id }));
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
