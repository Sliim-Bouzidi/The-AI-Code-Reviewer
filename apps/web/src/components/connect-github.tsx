'use client';

import { IconBrandGithub } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage, useApi } from '@/lib/api';

/** Submits the GitHub App manifest to GitHub the way GitHub requires: a browser form POST. */
function postManifest(postUrl: string, manifest: Record<string, unknown>) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = postUrl;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'manifest';
  input.value = JSON.stringify(manifest);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

/**
 * First run: "Create GitHub App" (one confirmation on GitHub, no copy-pasting of keys), after which
 * GitHub sends the user on to pick repositories. Later: just the install page for more repos.
 */
export function ConnectGithubButton({ label }: { label?: string }) {
  const api = useApi();
  const [busy, setBusy] = React.useState(false);
  const status = useQuery({ queryKey: ['setup-status'], queryFn: api.setupStatus });
  const needsApp = status.data ? !status.data.githubAppConfigured : false;
  return (
    <Button
      disabled={busy || status.isPending}
      onClick={async () => {
        setBusy(true);
        try {
          if (needsApp) {
            const { postUrl, manifest } = await api.githubAppManifest();
            postManifest(postUrl, manifest);
          } else {
            window.location.href = (await api.installUrl()).url;
          }
        } catch (err) {
          toast.error(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <IconBrandGithub />
      {label ?? (needsApp ? 'Create GitHub App & connect' : 'Connect GitHub')}
    </Button>
  );
}
