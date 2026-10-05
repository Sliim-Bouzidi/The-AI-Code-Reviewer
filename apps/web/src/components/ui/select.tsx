'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { IconCheck, IconSelector } from '@tabler/icons-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  hint?: React.ReactNode; // small secondary text under the label
}

/**
 * Themed dropdown (Base UI Select): same look as the inputs and popovers in light and dark mode,
 * keyboard accessible, unlike the browser's native <select> list which ignores the theme.
 */
export function Select({
  id,
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  className,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const items = React.useMemo(() => Object.fromEntries(options.map((o) => [o.value, o.label])), [options]);
  return (
    <SelectPrimitive.Root items={items} value={value} onValueChange={(v) => onValueChange((v as string | null) ?? '')}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'border-input dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 data-[popup-open]:border-ring flex h-8 min-w-36 shrink-0 cursor-default items-center justify-between gap-2 rounded-lg border bg-transparent px-2.5 text-sm whitespace-nowrap outline-none transition-colors select-none focus-visible:ring-3',
          className,
        )}
      >
        <SelectPrimitive.Value className='truncate data-[placeholder]:text-muted-foreground' placeholder={placeholder} />
        <SelectPrimitive.Icon className='text-muted-foreground flex'>
          <IconSelector className='size-4' />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={6} alignItemWithTrigger={false} className='z-50 outline-none'>
          <SelectPrimitive.Popup
            className={cn(
              'bg-popover text-popover-foreground min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-hidden rounded-xl border p-1 shadow-lg outline-none',
              'transition-[transform,opacity] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
            )}
          >
            <SelectPrimitive.List className='max-h-72 overflow-y-auto'>
              {options.map((o) => (
                <SelectPrimitive.Item
                  key={o.value}
                  value={o.value}
                  className='data-[highlighted]:bg-muted data-[selected]:font-medium grid cursor-default grid-cols-[1rem_1fr] items-start gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none'
                >
                  <SelectPrimitive.ItemIndicator className='mt-0.5 flex'>
                    <IconCheck className='size-4' />
                  </SelectPrimitive.ItemIndicator>
                  <span className='col-start-2 flex min-w-0 flex-col'>
                    <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                    {o.hint && <span className='text-muted-foreground text-xs font-normal'>{o.hint}</span>}
                  </span>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
