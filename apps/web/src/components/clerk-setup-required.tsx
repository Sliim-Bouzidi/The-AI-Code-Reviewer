'use client';

import { IconCheck, IconExternalLink, IconLock } from '@tabler/icons-react';
import * as React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { API_URL } from '@/lib/api';

/**
 * First-run setup of sign-in: paste the two Clerk keys here; the API checks them with Clerk and
 * saves them, and sign-in works right away (no .env edit, no rebuild). Shown on /sign-in while no
 * Clerk keys are configured; the API refuses once they are.
 */
export function ClerkSetupRequired() {
  const [publishableKey, setPublishableKey] = React.useState('');
  const [secretKey, setSecretKey] = React.useState('');
  const [state, setState] = React.useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('saving');
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/setup/clerk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publishableKey: publishableKey.trim(), secretKey: secretKey.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
      if (!res.ok) {
        // 409 = someone already configured it (e.g. another tab): just reload into sign-in
        if (res.status === 409) {
          window.location.href = '/sign-in';
          return;
        }
        throw new Error(Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? `Request failed (${res.status})`));
      }
      setState('done');
      // full reload: the page is rendered again with the new keys and shows Clerk's sign-in form
      setTimeout(() => (window.location.href = '/sign-in'), 800);
    } catch (err) {
      setState('idle');
      setError(err instanceof TypeError ? `Cannot reach the API at ${API_URL}. Is the app running?` : (err as Error).message);
    }
  }

  return (
    <div className='flex w-full max-w-md flex-col gap-5 rounded-xl border p-6'>
      <div className='flex flex-col gap-1'>
        <div className='flex items-center gap-2'>
          <IconLock className='size-5' />
          <h1 className='text-lg font-semibold'>Set up sign-in</h1>
        </div>
        <p className='text-muted-foreground text-sm'>
          This app uses Clerk for login. It is a one-time step for whoever runs the app: paste the two keys below and sign-in
          works right away, no restart needed.
        </p>
      </div>

      <ol className='text-muted-foreground list-decimal space-y-1 pl-5 text-sm'>
        <li>
          Open{' '}
          <a className='text-foreground inline-flex items-center gap-0.5 underline underline-offset-4' href='https://dashboard.clerk.com' target='_blank' rel='noreferrer'>
            dashboard.clerk.com <IconExternalLink className='size-3.5' />
          </a>{' '}
          and create an application (free). Turn on the sign-in methods you want, e.g. GitHub.
        </li>
        <li>
          In that application, go to <strong className='text-foreground'>API keys</strong> and copy the two keys here.
        </li>
      </ol>

      {state === 'done' ? (
        <p className='flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400'>
          <IconCheck className='size-4' /> Keys saved. Opening sign-in…
        </p>
      ) : (
        <form className='flex flex-col gap-4' onSubmit={submit}>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='clerk-pk'>Publishable key</Label>
            <Input
              id='clerk-pk'
              autoComplete='off'
              spellCheck={false}
              placeholder='pk_test_…'
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              className='font-mono text-xs'
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='clerk-sk'>Secret key</Label>
            <Input
              id='clerk-sk'
              type='password'
              autoComplete='off'
              placeholder='sk_test_…'
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              className='font-mono text-xs'
            />
          </div>
          {error && (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type='submit' disabled={!publishableKey.trim() || !secretKey.trim() || state === 'saving'}>
            {state === 'saving' ? <Spinner className='size-4' /> : null}
            {state === 'saving' ? 'Checking the keys with Clerk…' : 'Save and continue'}
          </Button>
          <p className='text-muted-foreground text-xs'>
            The keys are checked with Clerk, then stored on this server only. Keys in a <code className='font-mono'>.env</code>{' '}
            file still work and take priority.
          </p>
        </form>
      )}
    </div>
  );
}
