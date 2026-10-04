'use client';

import { IconBrandGithub } from '@tabler/icons-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage, useApi } from '@/lib/api';

/** Sends the browser to the GitHub App install page; GitHub then returns to /dashboard/repos. */
export function ConnectGithubButton({ label = 'Connect GitHub' }: { label?: string }) {
  const api = useApi();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          window.location.href = (await api.installUrl()).url;
        } catch (err) {
          toast.error(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <IconBrandGithub />
      {label}
    </Button>
  );
}
