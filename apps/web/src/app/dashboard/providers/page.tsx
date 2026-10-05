'use client';

import type { LlmKeyStatus, LlmSettingsResponse, LlmSlotStatus, TestLlmResponse, UpdateLlmSettings } from '@codereview/shared';
import { IconCheck, IconExternalLink, IconPlugConnected, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import PageContainer from '@/components/layout/page-container';
import { LoadError, RowsSkeleton } from '@/components/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage, useApi } from '@/lib/api';

type Slot = 'primary' | 'fallback' | 'embeddings';

const PROVIDER_LABEL: Record<string, string> = { gemini: 'Google Gemini', openrouter: 'OpenRouter', openai: 'OpenAI-compatible' };

/** Ready-made settings for popular OpenAI-compatible free tiers (see freellm.net). */
const PRESETS = [
  { name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'z-ai/glm-5.3', keyUrl: 'https://build.nvidia.com/settings/api-keys' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  { name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', model: 'zai-glm-4.7', keyUrl: 'https://cloud.cerebras.ai/' },
];

function SourceBadge({ status }: { status: LlmKeyStatus }) {
  if (!status.set) return <Badge variant='secondary'>Not set</Badge>;
  return (
    <Badge variant='outline' className='font-mono'>
      ••••{status.last4} · {status.source === 'dashboard' ? 'saved here' : 'from .env'}
    </Badge>
  );
}

/** One row of "what is used right now", with a live test button. */
function ActiveRow({ title, hint, slot, status }: { title: string; hint: string; slot: Slot; status: LlmSlotStatus }) {
  const api = useApi();
  const [result, setResult] = React.useState<TestLlmResponse | null>(null);
  const test = useMutation({
    mutationFn: () => api.testLlm(slot),
    onSuccess: setResult,
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div className='flex flex-col gap-2 border-t py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between'>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-medium'>{title}</span>
          {status.configured ? (
            <Badge variant='outline' className='border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'>
              Connected
            </Badge>
          ) : (
            <Badge variant='secondary'>Not configured</Badge>
          )}
        </div>
        <p className='text-muted-foreground text-xs'>{hint}</p>
        <p className='mt-1 text-sm'>
          {status.configured ? (
            <>
              <span className='capitalize'>{status.provider}</span> · <span className='font-mono text-xs'>{status.model}</span>
            </>
          ) : (
            <span className='text-muted-foreground'>Add a key and a model below.</span>
          )}
        </p>
        {result && (
          <p className={`mt-1 flex items-start gap-1 text-xs ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
            {result.ok ? <IconCheck className='size-4 shrink-0' /> : <IconX className='size-4 shrink-0' />}
            <span>
              {result.ok ? 'Works' : 'Failed'} ({(result.ms / 1000).toFixed(1)} s): {result.message}
            </span>
          </p>
        )}
      </div>
      <Button variant='outline' size='sm' disabled={!status.configured || test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? <Spinner className='size-3' /> : <IconPlugConnected />}
        Test
      </Button>
    </div>
  );
}

/** Paste a key; it is sent once and never shown again. */
function KeyField({
  id, label, status, field, save, saving, help,
}: {
  id: string;
  label: string;
  status: LlmKeyStatus;
  field: 'geminiApiKey' | 'openrouterApiKey' | 'openaiCompatApiKey';
  save: (body: UpdateLlmSettings) => void;
  saving: boolean;
  help: React.ReactNode;
}) {
  const [value, setValue] = React.useState('');
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Label htmlFor={id}>{label}</Label>
        <SourceBadge status={status} />
      </div>
      <form
        className='flex gap-2'
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          save({ [field]: value.trim() });
          setValue('');
        }}
      >
        <Input
          id={id}
          type='password'
          autoComplete='off'
          placeholder={status.set ? 'Paste a new key to replace it' : 'Paste your key'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className='font-mono text-xs'
        />
        <Button type='submit' disabled={!value.trim() || saving}>
          Save
        </Button>
        {status.source === 'dashboard' && (
          <Button type='button' variant='outline' disabled={saving} onClick={() => save({ [field]: '' })} title='Remove the key saved here (the .env one, if any, applies again)'>
            Remove
          </Button>
        )}
      </form>
      <p className='text-muted-foreground text-xs'>{help}</p>
    </div>
  );
}

function ModelChoice({ data, save, saving }: { data: LlmSettingsResponse; save: (b: UpdateLlmSettings) => void; saving: boolean }) {
  const [form, setForm] = React.useState(() => ({
    llmProvider: data.choice.llmProvider ?? 'gemini',
    llmModel: data.choice.llmModel ?? '',
    llmFallbackProvider: data.choice.llmFallbackProvider ?? '',
    llmFallbackModel: data.choice.llmFallbackModel ?? '',
    embeddingModel: data.choice.embeddingModel ?? '',
  }));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className='grid gap-4 md:grid-cols-2'
      onSubmit={(e) => {
        e.preventDefault();
        save(form as UpdateLlmSettings);
      }}
    >
      <div className='flex flex-col gap-2'>
        <Label htmlFor='primary-provider'>Main reviewer</Label>
        <div className='flex gap-2'>
          <NativeSelect id='primary-provider' value={form.llmProvider} onChange={set('llmProvider')}>
            {Object.entries(PROVIDER_LABEL).map(([v, l]) => (
              <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>
            ))}
          </NativeSelect>
          <Input aria-label='Main model' placeholder='model, e.g. gemini-3.5-flash' value={form.llmModel} onChange={set('llmModel')} className='font-mono text-xs' />
        </div>
      </div>
      <div className='flex flex-col gap-2'>
        <Label htmlFor='fallback-provider'>Fallback (used when the main one fails)</Label>
        <div className='flex gap-2'>
          <NativeSelect id='fallback-provider' value={form.llmFallbackProvider} onChange={set('llmFallbackProvider')}>
            <NativeSelectOption value=''>Default</NativeSelectOption>
            {Object.entries(PROVIDER_LABEL).map(([v, l]) => (
              <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>
            ))}
          </NativeSelect>
          <Input aria-label='Fallback model' placeholder='model, e.g. z-ai/glm-5.3' value={form.llmFallbackModel} onChange={set('llmFallbackModel')} className='font-mono text-xs' />
        </div>
      </div>
      <div className='flex flex-col gap-2'>
        <Label htmlFor='embedding-model'>Indexing model (Gemini embeddings)</Label>
        <Input id='embedding-model' placeholder='gemini-embedding-001' value={form.embeddingModel} onChange={set('embeddingModel')} className='font-mono text-xs' />
      </div>
      <div className='flex items-end justify-end'>
        <Button type='submit' disabled={saving}>Save models</Button>
      </div>
    </form>
  );
}

export default function ProvidersPage() {
  const api = useApi();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['llm-settings'], queryFn: api.llmSettings });
  const [baseUrl, setBaseUrl] = React.useState<string | null>(null);

  const update = useMutation({
    mutationFn: api.updateLlmSettings,
    onSuccess: (data) => {
      qc.setQueryData(['llm-settings'], data);
      toast.success('Saved. The worker uses it from its next review.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const save = (body: UpdateLlmSettings) => update.mutate(body);

  const d = settings.data;
  const currentBaseUrl = baseUrl ?? d?.keys.openai.baseUrl ?? '';

  return (
    <PageContainer
      title='AI providers'
      description='Which AI models review your pull requests and index your code. Keys saved here override the .env file and apply without a restart.'
    >
      {settings.isError ? (
        <LoadError error={settings.error} />
      ) : settings.isPending ? (
        <RowsSkeleton />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>In use right now</CardTitle>
              <CardDescription>“Test” makes one tiny real call, so a wrong key or a used-up quota shows up immediately.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActiveRow title='Main reviewer' hint='Reviews every changed file.' slot='primary' status={d!.active.primary} />
              <ActiveRow title='Fallback' hint='Takes over when the main one fails (quota, outage).' slot='fallback' status={d!.active.fallback} />
              <ActiveRow title='Indexing' hint='Embeddings for codebase search and review context (Gemini only).' slot='embeddings' status={d!.active.embeddings} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>API keys</CardTitle>
              <CardDescription>Keys are write-only: after saving, only the last 4 characters are shown.</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-6'>
              <KeyField
                id='gemini-key'
                label='Google Gemini'
                field='geminiApiKey'
                status={d!.keys.gemini}
                save={save}
                saving={update.isPending}
                help={
                  <>
                    Needed for indexing. Free key at{' '}
                    <a className='underline underline-offset-4' href='https://aistudio.google.com/apikey' target='_blank' rel='noreferrer'>
                      aistudio.google.com
                    </a>{' '}
                    (about 20 review calls a day on the free tier).
                  </>
                }
              />
              <KeyField
                id='openrouter-key'
                label='OpenRouter'
                field='openrouterApiKey'
                status={d!.keys.openrouter}
                save={save}
                saving={update.isPending}
                help={
                  <>
                    Free models end in <code className='font-mono'>:free</code>. Key at{' '}
                    <a className='underline underline-offset-4' href='https://openrouter.ai/keys' target='_blank' rel='noreferrer'>
                      openrouter.ai/keys
                    </a>
                    .
                  </>
                }
              />
              <div className='flex flex-col gap-3 rounded-lg border p-4'>
                <div>
                  <span className='font-medium'>OpenAI-compatible provider</span>
                  <p className='text-muted-foreground text-xs'>
                    NVIDIA NIM, Groq, Cerebras and most providers on{' '}
                    <a className='underline underline-offset-4' href='https://freellm.net' target='_blank' rel='noreferrer'>
                      freellm.net
                    </a>
                    . Pick a preset or enter the base URL yourself, then choose “OpenAI-compatible” as main or fallback below.
                  </p>
                </div>
                <div className='flex flex-wrap gap-2'>
                  {PRESETS.map((p) => (
                    <div key={p.name} className='flex items-center gap-1'>
                      <Button type='button' variant={currentBaseUrl === p.baseUrl ? 'default' : 'outline'} size='sm' onClick={() => setBaseUrl(p.baseUrl)}>
                        {p.name}
                      </Button>
                      <a href={p.keyUrl} target='_blank' rel='noreferrer' className='text-muted-foreground hover:text-foreground' title={`Get a ${p.name} key`} aria-label={`Get a ${p.name} key`}>
                        <IconExternalLink className='size-4' />
                      </a>
                    </div>
                  ))}
                </div>
                <form
                  className='flex flex-col gap-2'
                  onSubmit={(e) => {
                    e.preventDefault();
                    save({ openaiCompatBaseUrl: currentBaseUrl.trim() });
                  }}
                >
                  <Label htmlFor='compat-url'>Base URL</Label>
                  <div className='flex gap-2'>
                    <Input
                      id='compat-url'
                      placeholder='https://integrate.api.nvidia.com/v1'
                      value={currentBaseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className='font-mono text-xs'
                    />
                    <Button type='submit' disabled={update.isPending || currentBaseUrl === (d!.keys.openai.baseUrl ?? '')}>
                      Save
                    </Button>
                  </div>
                  {PRESETS.find((p) => p.baseUrl === currentBaseUrl) && (
                    <p className='text-muted-foreground text-xs'>
                      Suggested model: <code className='font-mono'>{PRESETS.find((p) => p.baseUrl === currentBaseUrl)!.model}</code>
                    </p>
                  )}
                </form>
                <KeyField
                  id='compat-key'
                  label='API key'
                  field='openaiCompatApiKey'
                  status={d!.keys.openai}
                  save={save}
                  saving={update.isPending}
                  help='The key for the base URL above.'
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Which models to use</CardTitle>
              <CardDescription>Model names are exactly as the provider spells them. Leave the fallback on “Default” to use the other of Gemini/OpenRouter.</CardDescription>
            </CardHeader>
            <CardContent>
              {/* key: re-mount the form with fresh values after each save */}
              <ModelChoice key={JSON.stringify(d!.choice)} data={d!} save={save} saving={update.isPending} />
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  );
}
