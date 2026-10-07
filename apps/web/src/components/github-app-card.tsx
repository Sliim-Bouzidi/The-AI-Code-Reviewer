'use client';

import { IconBrandGithub, IconExternalLink, IconInfoCircle, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage, useApi } from '@/lib/api';

/**
 * Which GitHub App this install uses and who owns it. Everyone connects their own repositories
 * through it; while the app is private only its owner can install it, which is what GitHub's
 * "this is a private GitHub App" page means. "Recreate" (admin only) forgets the app.
 */
export function GithubAppCard() {
  const api = useApi();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['setup-status'], queryFn: api.setupStatus });
  const [confirming, setConfirming] = React.useState(false);
  const reset = useMutation({
    mutationFn: api.resetGithubApp,
    onSuccess: (r) => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['setup-status'] });
      void qc.invalidateQueries({ queryKey: ['repos'] });
      toast.success(
        `GitHub App removed${r.removedInstallations ? ` (${r.removedInstallations} installation(s) disconnected)` : ''}. Create a new one with “Create GitHub App & connect”.`,
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const s = status.data;
  if (!s) return null;

  if (!s.githubAppConfigured) {
    return (
      <Alert>
        <IconInfoCircle />
        <AlertTitle>Before you create the GitHub App</AlertTitle>
        <AlertDescription>
          The app will belong to the GitHub account you are logged into <strong>in this browser</strong>, and only that account
          can install it. Check you are signed in to GitHub with the account whose repositories you want reviewed.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className='flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between'>
      <div className='flex min-w-0 items-start gap-3'>
        <IconBrandGithub className='mt-0.5 size-5 shrink-0' />
        <div className='min-w-0 text-sm'>
          <div className='flex flex-wrap items-center gap-x-2'>
            <span className='font-medium'>GitHub App</span>
            {s.appUrl ? (
              <a href={s.appUrl} target='_blank' rel='noreferrer' className='flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline'>
                {s.appSlug} <IconExternalLink className='size-3.5' />
              </a>
            ) : (
              <span className='font-mono text-xs'>{s.appSlug}</span>
            )}
          </div>
          <p className='text-muted-foreground text-xs'>
            {s.appOwner ? (
              <>
                Owned by <strong className='text-foreground'>@{s.appOwner}</strong>. Use “Add repositories” to choose which of your
                repositories it reviews.{' '}
                {s.isAdmin
                  ? 'If other people see “this is a private GitHub App”, make it public: GitHub → Settings → Developer settings → GitHub Apps → Advanced.'
                  : 'If GitHub says “this is a private GitHub App”, the owner has not opened it to other accounts yet.'}
              </>
            ) : (
              'Could not reach GitHub to check who owns this app.'
            )}
          </p>
        </div>
      </div>
      {s.appSource === 'dashboard' && s.isAdmin && (
        <Button variant='outline' size='sm' className='shrink-0' onClick={() => setConfirming(true)}>
          <IconRefresh /> Recreate GitHub App
        </Button>
      )}

      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recreate the GitHub App?</DialogTitle>
            <DialogDescription>
              Use this when the app was created under the wrong GitHub account. This install forgets{' '}
              <span className='font-mono'>{s.appSlug}</span>
              {s.appOwner ? ` (owned by @${s.appOwner})` : ''} and disconnects its repositories here, including their review history.
              Then log into GitHub with the right account and click “Create GitHub App & connect”.
            </DialogDescription>
          </DialogHeader>
          <p className='text-muted-foreground text-xs'>
            The old app stays on GitHub: delete it there if you no longer need it (Settings → Developer settings → GitHub Apps).
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant='destructive' disabled={reset.isPending} onClick={() => reset.mutate()}>
              {reset.isPending ? 'Removing…' : 'Forget this app'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
