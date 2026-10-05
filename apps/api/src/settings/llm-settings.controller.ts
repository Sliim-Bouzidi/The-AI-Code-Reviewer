import { Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common';
import {
  clearLlmSettingsCache, getLlmEnv, getLlmSettingsRow, LLM_SETTING_ENV, llmSettings,
} from '@codereview/db';
import type { Db, LlmSettingField } from '@codereview/db';
import { createEmbedderFromEnv, resolveProviders } from '@codereview/llm';
import type { LlmProvider } from '@codereview/llm';
import { TestLlmBodySchema, UpdateLlmSettingsSchema } from '@codereview/shared';
import type {
  LlmKeyStatus, LlmSettingsResponse, LlmSlotStatus, TestLlmResponse, UpdateLlmSettings,
} from '@codereview/shared';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { DB } from '../common/db.module.js';
import { ZodPipe } from '../common/zod.pipe.js';

/**
 * AI provider settings for the "AI providers" dashboard page. Values saved here override `.env`
 * (see getLlmEnv); the worker picks them up before its next job, without a restart.
 * Demo limitation: any signed-in user can change these (single-tenant install).
 */
@Controller('api/settings/llm')
@UseGuards(AuthGuard)
export class LlmSettingsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async get(): Promise<LlmSettingsResponse> {
    const row = await getLlmSettingsRow(this.db);
    const env = await getLlmEnv(this.db);
    const source = (field: LlmSettingField) =>
      row?.[field] ? ('dashboard' as const) : process.env[LLM_SETTING_ENV[field]] ? ('env' as const) : null;
    const key = (field: LlmSettingField): LlmKeyStatus => {
      const value = env[LLM_SETTING_ENV[field]];
      return { set: !!value, last4: value ? value.slice(-4) : null, source: source(field) };
    };

    // exactly what the factory builds for the worker
    const { primary, fallback } = resolveProviders(env);
    const slot = (p: LlmProvider | null, wantedModel: string | undefined): LlmSlotStatus => ({
      provider: p?.name ?? null,
      model: p?.model ?? wantedModel ?? null,
      configured: !!p,
    });
    const embedder = createEmbedderFromEnv(env);

    return {
      keys: {
        gemini: key('geminiApiKey'),
        openrouter: key('openrouterApiKey'),
        openai: { ...key('openaiCompatApiKey'), baseUrl: env.OPENAI_COMPAT_BASE_URL || null },
      },
      choice: {
        llmProvider: env.LLM_PROVIDER || 'gemini',
        llmModel: env.LLM_MODEL || null,
        llmFallbackProvider: env.LLM_FALLBACK_PROVIDER || null,
        llmFallbackModel: env.LLM_FALLBACK_MODEL || null,
        embeddingModel: env.EMBEDDING_MODEL || null,
      },
      active: {
        primary: slot(primary, env.LLM_MODEL),
        fallback: slot(fallback, env.LLM_FALLBACK_MODEL),
        embeddings: { provider: embedder ? 'gemini' : null, model: env.EMBEDDING_MODEL || null, configured: !!embedder },
      },
    };
  }

  @Put()
  async update(@Body(new ZodPipe(UpdateLlmSettingsSchema)) body: UpdateLlmSettings): Promise<LlmSettingsResponse> {
    const values: Partial<Record<LlmSettingField, string | null>> = {};
    for (const field of Object.keys(LLM_SETTING_ENV) as LlmSettingField[]) {
      const value = body[field];
      if (value !== undefined) values[field] = value === '' ? null : value; // "" = back to .env
    }
    if (Object.keys(values).length > 0) {
      await this.db
        .insert(llmSettings)
        .values({ id: 'default', ...values, updatedAt: new Date() })
        .onConflictDoUpdate({ target: llmSettings.id, set: { ...values, updatedAt: new Date() } });
      clearLlmSettingsCache();
    }
    return this.get();
  }

  /** Makes one tiny real call with the current settings, so a wrong key shows up right away. */
  @Post('test')
  async test(@Body(new ZodPipe(TestLlmBodySchema)) body: z.infer<typeof TestLlmBodySchema>): Promise<TestLlmResponse> {
    const env = await getLlmEnv(this.db);
    const started = Date.now();
    const done = (ok: boolean, provider: string | null, model: string | null, message: string): TestLlmResponse => ({
      ok, ms: Date.now() - started, provider, model, message,
    });

    if (body.slot === 'embeddings') {
      const embedder = createEmbedderFromEnv(env);
      if (!embedder) return done(false, null, null, 'Not configured: needs a Gemini key and an embedding model.');
      try {
        const [vector] = await embedder.embed(['hello'], 'query');
        return done(true, 'gemini', embedder.model, `Returned a ${vector?.length ?? 0}-dimension vector.`);
      } catch (err) {
        return done(false, 'gemini', embedder.model, short(err));
      }
    }

    const slots = resolveProviders(env);
    const provider = body.slot === 'primary' ? slots.primary : slots.fallback;
    const wanted = body.slot === 'primary' ? env.LLM_MODEL : env.LLM_FALLBACK_MODEL;
    if (!provider) return done(false, null, wanted ?? null, 'Not configured: pick a provider, add its key and a model.');
    try {
      const res = await provider.generate({ system: 'You are a connectivity check.', prompt: 'Reply with the word OK.' });
      return done(true, provider.name, provider.model, `Answered: "${res.text.trim().slice(0, 40)}"`);
    } catch (err) {
      return done(false, provider.name, provider.model, short(err));
    }
  }
}

/** Error text without huge provider bodies. Keys are never part of these messages. */
function short(err: unknown): string {
  const message = (err as Error).message ?? String(err);
  const quota = /"message"\s*:\s*"([^"]{0,200})/.exec(message)?.[1];
  return (quota ?? message).slice(0, 240);
}
