'use client';

import { IconCopy, IconKey, IconPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import PageContainer from '@/components/layout/page-container';
import { LoadError, RowsSkeleton } from '@/components/query-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { API_URL, errorMessage, useApi } from '@/lib/api';
import type { ApiKey } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Could not copy. Select the text and copy it by hand.');
  }
}

export default function KeysPage() {
  const api = useApi();
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ['keys'], queryFn: api.keys });
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [created, setCreated] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<ApiKey | null>(null);

  const create = useMutation({
    mutationFn: () => api.createKey(name.trim()),
    onSuccess: (key) => {
      setCreated(key.key);
      qc.invalidateQueries({ queryKey: ['keys'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeKey(id),
    onSuccess: () => {
      setRevoking(null);
      qc.invalidateQueries({ queryKey: ['keys'] });
      toast.success('Key revoked');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const closeCreate = () => {
    setOpen(false);
    setName('');
    setCreated(null);
    create.reset();
  };
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        codereview: {
          command: 'node',
          args: ['<path to this project>/apps/mcp/dist/stdio.js'],
          env: { CODEREVIEW_API_URL: API_URL, CODEREVIEW_API_KEY: created ?? '<your API key>' },
        },
      },
    },
    null,
    2,
  );
  const active = keys.data?.filter((k) => !k.revokedAt) ?? [];
  const revoked = keys.data?.filter((k) => k.revokedAt) ?? [];

  return (
    <PageContainer
      title='API keys'
      description='Keys let the MCP server (for example in Claude Code) call this reviewer on your behalf.'
      action={
        <Button onClick={() => setOpen(true)}>
          <IconPlus />
          Create key
        </Button>
      }
    >
      {keys.isError ? (
        <LoadError error={keys.error} />
      ) : keys.isPending ? (
        <RowsSkeleton />
      ) : keys.data.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <IconKey />
            </EmptyMedia>
            <EmptyTitle>No API keys</EmptyTitle>
            <EmptyDescription>Create a key to connect the MCP server.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...active, ...revoked].map((k) => (
                  <TableRow key={k.id} className={k.revokedAt ? 'text-muted-foreground' : undefined}>
                    <TableCell className='font-medium'>{k.name}</TableCell>
                    <TableCell className='font-mono text-xs'>{k.prefix}…</TableCell>
                    <TableCell>{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Never'}</TableCell>
                    <TableCell>
                      {k.revokedAt ? <Badge variant='secondary'>Revoked</Badge> : <Badge variant='outline'>Active</Badge>}
                    </TableCell>
                    <TableCell className='text-right'>
                      {!k.revokedAt && (
                        <Button variant='destructive' size='sm' onClick={() => setRevoking(k)}>
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Use it from Claude Code</CardTitle>
          <CardDescription>
            Add this to the <code className='font-mono'>.mcp.json</code> of the project you want reviewed, with your key and the
            path to this project. Then run <code className='font-mono'>/mcp__codereview__review</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className='bg-muted overflow-x-auto rounded-lg p-3 font-mono text-xs leading-relaxed'>{mcpConfig}</pre>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeCreate())}>
        <DialogContent>
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your key now</DialogTitle>
                <DialogDescription>It is shown only this once. Only a hash is stored.</DialogDescription>
              </DialogHeader>
              <div className='flex items-center gap-2'>
                <Input readOnly value={created} aria-label='New API key' className='font-mono text-xs' onFocus={(e) => e.target.select()} />
                <Button variant='outline' size='icon' aria-label='Copy key' onClick={() => copy(created, 'Key')}>
                  <IconCopy />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={closeCreate}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <form
              className='flex flex-col gap-4'
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate();
              }}
            >
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>Name it after where you will use it, so you know which one to revoke later.</DialogDescription>
              </DialogHeader>
              <div className='flex flex-col gap-2'>
                <Label htmlFor='key-name'>Name</Label>
                <Input id='key-name' autoFocus placeholder='My laptop' maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <DialogFooter>
                <Button type='button' variant='outline' onClick={closeCreate}>
                  Cancel
                </Button>
                <Button type='submit' disabled={!name.trim() || create.isPending}>
                  {create.isPending ? 'Creating' : 'Create key'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revoking?.name}”?</DialogTitle>
            <DialogDescription>Anything using this key stops working immediately. This cannot be undone.</DialogDescription>
          </DialogHeader>
          {revoke.isError && (
            <Alert variant='destructive'>
              <AlertTitle>Could not revoke</AlertTitle>
              <AlertDescription>{errorMessage(revoke.error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant='outline' onClick={() => setRevoking(null)}>
              Keep key
            </Button>
            <Button variant='destructive' disabled={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking.id)}>
              {revoke.isPending ? 'Revoking' : 'Revoke key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
