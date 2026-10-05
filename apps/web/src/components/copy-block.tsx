'use client';

import { IconCheck, IconCopy } from '@tabler/icons-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export async function copyText(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
    return true;
  } catch {
    toast.error('Could not copy. Select the text and copy it by hand.');
    return false;
  }
}

/** A code block with a copy button in its corner. */
export function CopyBlock({ code, label = 'Copy', copiedMessage = 'Copied' }: { code: string; label?: string; copiedMessage?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className='relative'>
      <pre className='bg-muted overflow-x-auto rounded-lg p-3 pr-12 font-mono text-xs leading-relaxed'>{code}</pre>
      <Button
        variant='outline'
        size='icon'
        aria-label={label}
        title={label}
        className='bg-background/80 absolute top-2 right-2 size-8'
        onClick={async () => {
          if (await copyText(code, copiedMessage)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? <IconCheck className='text-emerald-500' /> : <IconCopy />}
      </Button>
    </div>
  );
}
