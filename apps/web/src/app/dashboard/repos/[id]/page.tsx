'use client';

import type { CustomRule, RepoSettings, Severity, Strictness } from '@codereview/shared';
import { IconArrowLeft, IconPlus, IconTrash } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import PageContainer from '@/components/layout/page-container';
import { LoadError, RowsSkeleton } from '@/components/query-state';
import { ReviewsTable } from '@/components/reviews-table';
import { IndexStatusBadge, SEVERITY_ORDER } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, useApi } from '@/lib/api';

const PAGE_SIZE = 20;

function ReviewsTab({ repoId }: { repoId: string }) {
  const api = useApi();
  const [page, setPage] = React.useState(1);
  const reviews = useQuery({
    queryKey: ['reviews', repoId, page],
    queryFn: () => api.reviews(repoId, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => r.status === 'queued' || r.status === 'running') ? 4_000 : 20_000,
  });
  if (reviews.isError) return <LoadError error={reviews.error} />;
  if (reviews.isPending) return <RowsSkeleton />;
  if (reviews.data.total === 0) {
    return (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyTitle>No reviews yet</EmptyTitle>
          <EmptyDescription>Open a pull request on this repository while reviews are on.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const pages = Math.max(1, Math.ceil(reviews.data.total / PAGE_SIZE));
  return (
    <Card>
      <CardContent>
        <ReviewsTable reviews={reviews.data.items} />
      </CardContent>
      {pages > 1 && (
        <CardFooter className='justify-between'>
          <span className='text-muted-foreground text-sm'>
            Page {page} of {pages} ({reviews.data.total} reviews)
          </span>
          <div className='flex gap-2'>
            <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button variant='outline' size='sm' disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}

function SettingsForm({ repoId, initial }: { repoId: string; initial: RepoSettings }) {
  const api = useApi();
  const qc = useQueryClient();
  const [strictness, setStrictness] = React.useState<Strictness>(initial.strictness);
  const [maxComments, setMaxComments] = React.useState(String(initial.maxComments));
  const [ignored, setIgnored] = React.useState(initial.ignoredPaths.join('\n'));
  const [rules, setRules] = React.useState<CustomRule[]>(initial.customRules);

  const max = Number(maxComments);
  const maxValid = Number.isInteger(max) && max >= 1 && max <= 50;

  const save = useMutation({
    mutationFn: () =>
      api.updateSettings(repoId, {
        strictness,
        maxComments: max,
        ignoredPaths: ignored.split('\n').map((p) => p.trim()).filter(Boolean),
        customRules: rules.map((r) => ({ ...r, rule: r.rule.trim() })).filter((r) => r.rule),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(['settings', repoId], saved);
      setRules(saved.customRules);
      setIgnored(saved.ignoredPaths.join('\n'));
      toast.success('Settings saved. They apply to the next review.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (maxValid) save.mutate();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Review settings</CardTitle>
          <CardDescription>How strict the reviewer is on this repository, and what it should ignore.</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-6'>
          <div className='grid gap-6 sm:grid-cols-2'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='strictness'>Strictness</Label>
              <NativeSelect
                id='strictness'
                className='w-full'
                value={strictness}
                onChange={(e) => setStrictness(e.target.value as Strictness)}
              >
                <NativeSelectOption value='low'>Low: only serious problems</NativeSelectOption>
                <NativeSelectOption value='medium'>Medium: bugs and risky code</NativeSelectOption>
                <NativeSelectOption value='high'>High: include minor issues</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='max-comments'>Maximum comments per pull request</Label>
              <Input
                id='max-comments'
                type='number'
                min={1}
                max={50}
                value={maxComments}
                aria-invalid={!maxValid}
                aria-describedby='max-comments-help'
                onChange={(e) => setMaxComments(e.target.value)}
              />
              <p id='max-comments-help' className={maxValid ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}>
                A whole number from 1 to 50. The most severe findings are kept.
              </p>
            </div>
          </div>

          <div className='flex flex-col gap-2'>
            <Label htmlFor='ignored'>Ignored paths</Label>
            <Textarea
              id='ignored'
              rows={4}
              className='font-mono text-sm'
              placeholder={'dist/**\n**/*.generated.ts'}
              value={ignored}
              onChange={(e) => setIgnored(e.target.value)}
            />
            <p className='text-muted-foreground text-xs'>One glob pattern per line. Matching files are not reviewed.</p>
          </div>

          <fieldset className='flex flex-col gap-2'>
            <legend className='mb-2 text-sm font-medium'>Custom rules</legend>
            {rules.length === 0 && (
              <p className='text-muted-foreground text-sm'>No custom rules. Add one to tell the reviewer about a team convention.</p>
            )}
            {rules.map((rule, i) => (
              <div key={i} className='flex items-center gap-2'>
                <Input
                  aria-label={`Rule ${i + 1}`}
                  placeholder='Example: database queries must use parameters, never string concatenation'
                  value={rule.rule}
                  onChange={(e) => setRules(rules.map((r, j) => (j === i ? { ...r, rule: e.target.value } : r)))}
                />
                <NativeSelect
                  className='w-32 shrink-0'
                  aria-label={`Severity of rule ${i + 1}`}
                  value={rule.severity}
                  onChange={(e) =>
                    setRules(rules.map((r, j) => (j === i ? { ...r, severity: e.target.value as Severity } : r)))
                  }
                >
                  {SEVERITY_ORDER.map((s) => (
                    <NativeSelectOption key={s} value={s}>
                      {s}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  aria-label={`Remove rule ${i + 1}`}
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                >
                  <IconTrash />
                </Button>
              </div>
            ))}
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='w-fit'
              onClick={() => setRules([...rules, { rule: '', severity: 'medium' }])}
            >
              <IconPlus />
              Add rule
            </Button>
          </fieldset>
        </CardContent>
        <CardFooter>
          <Button type='submit' disabled={save.isPending || !maxValid}>
            {save.isPending ? 'Saving' : 'Save settings'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function SettingsTab({ repoId }: { repoId: string }) {
  const api = useApi();
  const settings = useQuery({ queryKey: ['settings', repoId], queryFn: () => api.settings(repoId) });
  if (settings.isError) return <LoadError error={settings.error} />;
  if (settings.isPending) return <RowsSkeleton />;
  return <SettingsForm repoId={repoId} initial={settings.data} />;
}

export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos });
  const repo = repos.data?.find((r) => r.id === id);

  return (
    <PageContainer
      title={repo?.fullName ?? (repos.isPending ? 'Repository' : 'Repository not found')}
      description={
        repo && (
          <span className='flex flex-wrap items-center gap-2'>
            <Badge variant={repo.enabled ? 'outline' : 'secondary'}>Reviews {repo.enabled ? 'on' : 'off'}</Badge>
            <IndexStatusBadge status={repo.indexStatus} />
            <a
              href={`https://github.com/${repo.fullName}`}
              target='_blank'
              rel='noreferrer'
              className='underline underline-offset-4'
            >
              Open on GitHub
            </a>
          </span>
        )
      }
      action={
        <Link href='/dashboard/repos' className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm'>
          <IconArrowLeft className='size-4' />
          All repositories
        </Link>
      }
    >
      {repos.isError ? (
        <LoadError error={repos.error} />
      ) : repos.isPending ? (
        <RowsSkeleton />
      ) : !repo ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>This repository is not connected</EmptyTitle>
            <EmptyDescription>It may have been removed from the GitHub App installation.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Tabs defaultValue='reviews'>
          <TabsList>
            <TabsTrigger value='reviews'>Reviews</TabsTrigger>
            <TabsTrigger value='settings'>Settings</TabsTrigger>
          </TabsList>
          <TabsContent value='reviews' className='pt-2'>
            <ReviewsTab repoId={repo.id} />
          </TabsContent>
          <TabsContent value='settings' className='pt-2'>
            <SettingsTab repoId={repo.id} />
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  );
}
