'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { IconBrandGithub, IconCheck, IconInfoCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { AuthShell } from '@/components/auth-shell';
import { ConnectGithubButton } from '@/components/connect-github';
import { Spinner } from '@/components/ui/spinner';
import { useApi } from '@/lib/api';

function Step({ n, done, title, children }: { n: number; done?: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className='flex gap-3'>
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${done ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : ''}`}
      >
        {done ? <IconCheck className='size-3.5' /> : n}
      </span>
      <div className='flex min-w-0 flex-col gap-2 pb-2'>
        <span className='text-sm font-medium'>{title}</span>
        {children}
      </div>
    </li>
  );
}

/**
 * Required step after sign-in: connect GitHub before the dashboard opens. Signing in (Gmail,
 * GitHub, ...) only identifies the person; this installs the GitHub App on their repositories.
 */
export default function OnboardingPage() {
  const api = useApi();
  const router = useRouter();
  const { user } = useUser();
  const { signOut } = useClerk();
  const setup = useQuery({ queryKey: ['setup-status'], queryFn: api.setupStatus });
  // also catches an install finished in another tab
  const connection = useQuery({ queryKey: ['github-connection'], queryFn: api.githubConnection, refetchInterval: 4_000 });

  React.useEffect(() => {
    if (connection.data?.connected) router.replace('/dashboard');
  }, [connection.data?.connected, router]);

  const appReady = !!setup.data?.githubAppConfigured;
  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <AuthShell>
      <div className='flex w-full max-w-md flex-col gap-6 rounded-xl border p-6'>
        <div className='flex flex-col gap-1'>
          <div className='flex items-center gap-2'>
            <IconBrandGithub className='size-5' />
            <h1 className='text-lg font-semibold'>Connect GitHub to continue</h1>
          </div>
          <p className='text-muted-foreground text-sm'>
            The reviewer works on your GitHub pull requests, so it needs access to your repositories before the dashboard opens.
            {email && (
              <>
                {' '}
                Signed in as <strong className='text-foreground'>{email}</strong>.
              </>
            )}
          </p>
        </div>

        {setup.isPending || connection.isPending || connection.data?.connected ? (
          <div className='text-muted-foreground flex items-center gap-2 text-sm'>
            <Spinner className='size-4' /> {connection.data?.connected ? 'Connected, opening the dashboard…' : 'Checking…'}
          </div>
        ) : (
          <ol className='flex flex-col gap-3'>
            <Step n={1} done={appReady} title={appReady ? 'GitHub App ready' : 'Create the GitHub App'}>
              {appReady ? (
                <p className='text-muted-foreground text-xs'>
                  <span className='font-mono'>{setup.data?.appSlug}</span>
                  {setup.data?.appOwner && <> · owned by @{setup.data.appOwner}</>}
                </p>
              ) : (
                <p className='text-muted-foreground flex gap-1.5 text-xs'>
                  <IconInfoCircle className='size-4 shrink-0' />
                  <span>
                    The app will belong to the GitHub account you are logged into <strong>in this browser</strong>, and only that
                    account can install it. Check that before you continue.
                  </span>
                </p>
              )}
            </Step>
            <Step n={2} title='Choose your repositories'>
              <p className='text-muted-foreground text-xs'>
                GitHub asks where to install the app: pick <strong>All repositories</strong> or <strong>Only select repositories</strong>.
                You are brought back here, and the dashboard opens.
              </p>
              <div>
                <ConnectGithubButton />
              </div>
            </Step>
          </ol>
        )}

        <button
          type='button'
          onClick={() => signOut({ redirectUrl: '/' })}
          className='text-muted-foreground hover:text-foreground self-start text-xs underline-offset-4 hover:underline'
        >
          Not you? Sign out
        </button>
      </div>
    </AuthShell>
  );
}
