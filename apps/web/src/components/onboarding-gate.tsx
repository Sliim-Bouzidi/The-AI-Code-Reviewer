'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useApi } from '@/lib/api';

/**
 * Keeps the dashboard closed until the signed-in user has connected GitHub (installed the GitHub
 * App on at least one account). Otherwise they are sent to /onboarding. This is a UX gate: the API
 * already limits every user to their own repositories.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const api = useApi();
  const router = useRouter();
  const connection = useQuery({ queryKey: ['github-connection'], queryFn: api.githubConnection, staleTime: 60_000 });
  const blocked = connection.isSuccess && !connection.data.connected;

  React.useEffect(() => {
    if (blocked) router.replace('/onboarding');
  }, [blocked, router]);

  // while checking (or redirecting), do not flash the dashboard; on an API error, let the pages show it
  if (connection.isPending || blocked) {
    return (
      <div className='text-muted-foreground flex min-h-svh items-center justify-center gap-2 text-sm'>
        <Spinner className='size-4' /> Loading…
      </div>
    );
  }
  return <>{children}</>;
}
