'use client';

import { Combobox } from '@base-ui/react/combobox';
import { IconCheck, IconSelector } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage, useApi } from '@/lib/api';
import type { ModelInfo } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Model picker: asks the provider which models the saved key can use and offers them as a
 * searchable list. Typing a name that is not in the list is still allowed (new/preview models).
 * When a provider mixes free and paid models (OpenRouter, Gemini), only the free ones are listed
 * until "Free models only" is unticked. `refreshKey` changes when keys or the base URL change.
 */
export function ModelCombobox({
  id,
  provider,
  kind = 'chat',
  value,
  onChange,
  refreshKey,
  placeholder = 'Pick or type a model',
  'aria-label': ariaLabel,
}: {
  id?: string;
  provider: string;
  kind?: 'chat' | 'embedding';
  value: string;
  onChange: (value: string) => void;
  refreshKey?: string;
  placeholder?: string;
  'aria-label'?: string;
}) {
  const api = useApi();
  const models = useQuery({
    queryKey: ['llm-models', provider, kind, refreshKey],
    queryFn: () => api.llmModels(provider, kind),
    enabled: !!provider,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const all = models.data?.models ?? [];
  const mixed = all.some((m) => m.free) && all.some((m) => !m.free);
  const [freeOnly, setFreeOnly] = React.useState(true);
  // the current choice stays listed even when it is a paid model
  const items = mixed && freeOnly ? all.filter((m) => m.free || m.id === value) : all;
  const selected = items.find((m) => m.id === value) ?? null;

  return (
    <div className='flex min-w-0 flex-1 flex-col gap-1'>
      <Combobox.Root
        items={items}
        value={selected}
        onValueChange={(m: ModelInfo | null) => m && onChange(m.id)}
        inputValue={value}
        onInputValueChange={(text) => onChange(text)}
        itemToStringLabel={(m: ModelInfo) => m.id}
        limit={200}
        openOnInputClick
      >
        <div className='relative'>
          <Combobox.Input
            id={id}
            aria-label={ariaLabel}
            placeholder={models.isPending ? 'Loading models…' : placeholder}
            className='border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full min-w-0 rounded-lg border bg-transparent py-1 pr-8 pl-2.5 font-mono text-xs outline-none focus-visible:ring-3'
          />
          <Combobox.Trigger
            aria-label='Show models'
            className='text-muted-foreground absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md'
          >
            {models.isFetching ? <Spinner className='size-3' /> : <IconSelector className='size-4' />}
          </Combobox.Trigger>
        </div>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={6} className='z-50 outline-none'>
            <Combobox.Popup className='bg-popover text-popover-foreground w-[var(--anchor-width)] min-w-64 origin-[var(--transform-origin)] overflow-hidden rounded-xl border p-1 shadow-lg outline-none transition-[transform,opacity] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0'>
              <Combobox.Empty className='text-muted-foreground px-2 py-2 text-xs empty:hidden'>
                No model matches. Press Enter or click outside to keep what you typed.
              </Combobox.Empty>
              <Combobox.List className='max-h-72 overflow-y-auto'>
                {(m: ModelInfo) => (
                  <Combobox.Item
                    key={m.id}
                    value={m}
                    className='data-[highlighted]:bg-muted grid cursor-default grid-cols-[1rem_1fr_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none'
                  >
                    <Combobox.ItemIndicator className='flex'>
                      <IconCheck className='size-4' />
                    </Combobox.ItemIndicator>
                    <span className='col-start-2 flex min-w-0 flex-col'>
                      <span className='truncate font-mono text-xs'>{m.id}</span>
                      {m.label && m.label !== m.id && <span className='text-muted-foreground truncate text-xs'>{m.label}</span>}
                    </span>
                    {m.free && (
                      <span className='rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400'>
                        free
                      </span>
                    )}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
        <p className={cn('text-xs', models.isError ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
          {models.isError
            ? `Could not load the list (${errorMessage(models.error)}). You can still type a model name.`
            : models.isSuccess
              ? mixed && freeOnly
                ? `${items.length} free of ${all.length} models`
                : `${all.length} model${all.length === 1 ? '' : 's'} available with this key`
              : ' '}
        </p>
        {mixed && (
          <label className='text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs select-none'>
            <input type='checkbox' className='accent-emerald-600' checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
            Free models only
          </label>
        )}
      </div>
    </div>
  );
}
