'use client';

import type { Review } from '@codereview/shared';
import { IconBrandGithub } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ConnectGithubButton } from '@/components/connect-github';
import PageContainer from '@/components/layout/page-container';
import { LoadError, RowsSkeleton } from '@/components/query-state';
import { ReviewsTable } from '@/components/reviews-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';

const isActive = (r: Review) => r.status === 'queued' || r.status === 'running';

export default function OverviewPage() {
  const api = useApi();
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 15_000 });
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos });
  // No "all reviews" endpoint in the API contract: take the latest few of every repo and merge.
  const recent = useQuery({
    queryKey: ['recent-reviews', repos.data?.map((r) => r.id)],
    enabled: Boolean(repos.data?.length),
    queryFn: async () => {
      const pages = await Promise.all(repos.data!.map((r) => api.reviews(r.id, 1, 10)));
      return pages
        .flatMap((p) => p.items)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10);
    },
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 4_000 : 15_000),
  });

  const cards = [
    { label: 'Reviews', value: stats.data?.totalReviews, hint: 'On your connected repositories' },
    { label: 'Findings', value: stats.data?.totalFindings, hint: 'Issues reported across all reviews' },
    { label: 'Active repositories', value: stats.data?.activeRepos, hint: 'With pull request reviews turned on' },
  ];
  const repoNames = Object.fromEntries((repos.data ?? []).map((r) => [r.id, r.fullName]));

  return (
    <PageContainer title='Overview' description='What the reviewer has done on your repositories.'>
      {stats.isError ? (
        <LoadError error={stats.error} />
      ) : (
        <div className='grid gap-4 md:grid-cols-3'>
          {cards.map((c) => (
            <Card key={c.label}>
              <CardHeader>
                <CardDescription>{c.label}</CardDescription>
                <CardTitle className='text-3xl font-semibold tabular-nums'>
                  {c.value ?? <Skeleton className='h-9 w-16' />}
                </CardTitle>
              </CardHeader>
              <CardContent className='text-muted-foreground text-sm'>{c.hint}</CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent reviews</CardTitle>
          <CardDescription>
            The latest reviews across <Link href='/dashboard/repos' className='underline underline-offset-4'>your repositories</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {repos.isError ? (
            <LoadError error={repos.error} />
          ) : repos.isPending || (repos.data.length > 0 && recent.isPending) ? (
            <RowsSkeleton />
          ) : repos.data.length === 0 ? (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <IconBrandGithub />
                </EmptyMedia>
                <EmptyTitle>No repositories connected</EmptyTitle>
                <EmptyDescription>Install the GitHub App on a repository to start reviewing its pull requests.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <ConnectGithubButton />
              </EmptyContent>
            </Empty>
          ) : recent.isError ? (
            <LoadError error={recent.error} />
          ) : recent.data!.length === 0 ? (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyTitle>No reviews yet</EmptyTitle>
                <EmptyDescription>
                  Turn reviews on for a repository, then open a pull request on it. The review appears here and as comments on GitHub.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ReviewsTable reviews={recent.data!} repoNames={repoNames} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
