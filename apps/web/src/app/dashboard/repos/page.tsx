'use client';

import type { Repo } from '@codereview/shared';
import { IconBrandGithub, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { ConnectGithubButton } from '@/components/connect-github';
import PageContainer from '@/components/layout/page-container';
import { LoadError, RowsSkeleton } from '@/components/query-state';
import { IndexStatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage, useApi } from '@/lib/api';

export default function ReposPage() {
  const api = useApi();
  const qc = useQueryClient();
  const repos = useQuery({
    queryKey: ['repos'],
    queryFn: api.repos,
    refetchInterval: (q) => (q.state.data?.some((r) => r.indexStatus === 'indexing') ? 4_000 : false),
  });
  const patch = (repo: Repo) =>
    qc.setQueryData<Repo[]>(['repos'], (old) => old?.map((r) => (r.id === repo.id ? { ...r, ...repo } : r)));

  const enable = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => api.enableRepo(v.id, v.enabled),
    onSuccess: (repo) => {
      patch(repo);
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success(`${repo.fullName}: reviews ${repo.enabled ? 'on' : 'off'}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const index = useMutation({
    mutationFn: (id: string) => api.indexRepo(id),
    onSuccess: (repo) => {
      patch(repo);
      toast.success(`${repo.fullName}: indexing started`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <PageContainer
      title='Repositories'
      description='Repositories the GitHub App is installed on. Turn reviews on to have new pull requests reviewed.'
      action={<ConnectGithubButton label='Add repositories' />}
    >
      {repos.isError ? (
        <LoadError error={repos.error} />
      ) : repos.isPending ? (
        <RowsSkeleton />
      ) : repos.data.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <IconBrandGithub />
            </EmptyMedia>
            <EmptyTitle>No repositories connected</EmptyTitle>
            <EmptyDescription>
              Install the GitHub App on a repository. You are sent back here when it is done.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ConnectGithubButton />
          </EmptyContent>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead>Default branch</TableHead>
                  <TableHead>Codebase index</TableHead>
                  <TableHead>Reviews</TableHead>
                  <TableHead className='text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repos.data.map((repo) => (
                  <TableRow key={repo.id}>
                    <TableCell>
                      <Link href={`/dashboard/repos/${repo.id}`} className='font-medium underline-offset-4 hover:underline'>
                        {repo.fullName}
                      </Link>
                    </TableCell>
                    <TableCell className='text-muted-foreground font-mono text-xs'>{repo.defaultBranch ?? '-'}</TableCell>
                    <TableCell>
                      <IndexStatusBadge status={repo.indexStatus} />
                      {repo.indexProgress && repo.indexStatus !== 'none' && (
                        <div
                          title={repo.indexProgress}
                          className={`mt-1 max-w-[16rem] truncate text-xs ${repo.indexStatus === 'failed' ? 'text-red-500' : 'text-muted-foreground'}`}
                        >
                          {repo.indexProgress}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <label className='flex w-fit items-center gap-2 text-sm'>
                        <Switch
                          checked={repo.enabled}
                          disabled={enable.isPending && enable.variables?.id === repo.id}
                          onCheckedChange={(enabled) => enable.mutate({ id: repo.id, enabled })}
                          aria-label={`Review pull requests on ${repo.fullName}`}
                        />
                        {repo.enabled ? 'On' : 'Off'}
                      </label>
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={repo.indexStatus === 'indexing' || index.isPending}
                        onClick={() => index.mutate(repo.id)}
                      >
                        <IconRefresh />
                        {repo.indexStatus === 'ready' ? 'Re-index' : 'Index'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
