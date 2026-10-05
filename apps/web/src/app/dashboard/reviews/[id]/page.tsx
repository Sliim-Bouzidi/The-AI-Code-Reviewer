'use client';

import type { Finding, Severity } from '@codereview/shared';
import { IconArrowLeft, IconBrandGithub, IconFile } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import PageContainer from '@/components/layout/page-container';
import { LoadError, RowsSkeleton } from '@/components/query-state';
import { ReviewTimeline } from '@/components/review-timeline';
import { ReviewStatusBadge, SEVERITY_ORDER, SeverityBadge } from '@/components/status';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { useApi } from '@/lib/api';
import { formatDuration, timeAgo } from '@/lib/utils';

const rank = (s: Severity) => SEVERITY_ORDER.indexOf(s);

function FindingCard({ finding }: { finding: Finding }) {
  const lines = finding.lineEnd && finding.lineEnd !== finding.lineStart
    ? `Lines ${finding.lineStart}-${finding.lineEnd}`
    : `Line ${finding.lineStart}`;
  return (
    <li className='border-border flex flex-col gap-2 border-t px-4 py-3 first:border-t-0'>
      <div className='flex flex-wrap items-center gap-2'>
        <SeverityBadge severity={finding.severity} />
        <Badge variant='secondary' className='capitalize'>{finding.category}</Badge>
        <span className='text-muted-foreground font-mono text-xs'>{lines}</span>
        {finding.source === 'semgrep' && <Badge variant='outline'>Semgrep</Badge>}
        {finding.posted && <span className='text-muted-foreground text-xs'>Posted on GitHub</span>}
      </div>
      <p className='text-sm leading-relaxed'>{finding.message}</p>
      {finding.suggestion && (
        <div>
          <div className='text-muted-foreground mb-1 text-xs font-medium'>Suggested fix</div>
          <pre className='bg-muted overflow-x-auto rounded-lg p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap'>
            {finding.suggestion}
          </pre>
        </div>
      )}
    </li>
  );
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const [filter, setFilter] = React.useState<Severity | 'all'>('all');
  const review = useQuery({
    queryKey: ['review', id],
    queryFn: () => api.review(id),
    // updates arrive over SSE (see ReviewTimeline); this slow poll is only a safety net
    refetchInterval: (q) => (q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 10_000 : false),
  });
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos });

  const r = review.data;
  const repo = repos.data?.find((x) => x.id === r?.repoId);
  const counts = SEVERITY_ORDER.map((s) => ({ severity: s, n: r?.findings.filter((f) => f.severity === s).length ?? 0 }))
    .filter((c) => c.n > 0);

  const byFile = new Map<string, Finding[]>();
  for (const f of [...(r?.findings ?? [])]
    .filter((f) => filter === 'all' || f.severity === filter)
    .sort((a, b) => rank(a.severity) - rank(b.severity) || a.lineStart - b.lineStart)) {
    byFile.set(f.filePath, [...(byFile.get(f.filePath) ?? []), f]);
  }

  const title = r ? (r.prNumber != null ? `#${r.prNumber} ${r.prTitle ?? ''}` : 'Local diff review') : 'Review';
  const back = r?.repoId ? `/dashboard/repos/${r.repoId}` : '/dashboard';

  return (
    <PageContainer
      title={title}
      description={
        r && (
          <span className='flex flex-wrap items-center gap-x-3 gap-y-1'>
            <ReviewStatusBadge status={r.status} />
            {repo && <span>{repo.fullName}</span>}
            <span>{timeAgo(r.createdAt)}</span>
            {r.model && <span>{r.model}</span>}
            {r.durationMs != null && <span>{formatDuration(r.durationMs)}</span>}
            {r.tokensIn != null && (
              <span className='tabular-nums'>
                {r.tokensIn.toLocaleString()} tokens in, {(r.tokensOut ?? 0).toLocaleString()} out
              </span>
            )}
          </span>
        )
      }
      action={
        <div className='flex items-center gap-3'>
          {repo && r?.prNumber != null && (
            <a
              href={`https://github.com/${repo.fullName}/pull/${r.prNumber}`}
              target='_blank'
              rel='noreferrer'
              className='flex items-center gap-1 text-sm underline underline-offset-4'
            >
              <IconBrandGithub className='size-4' />
              Open pull request
            </a>
          )}
          <Link href={back} className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm'>
            <IconArrowLeft className='size-4' />
            Back
          </Link>
        </div>
      }
    >
      {review.isError ? (
        <LoadError error={review.error} />
      ) : review.isPending ? (
        <RowsSkeleton />
      ) : (
        <>
          {r!.status === 'failed' && (
            <Alert variant='destructive'>
              <AlertTitle>This review failed</AlertTitle>
              <AlertDescription>{r!.error ?? 'The worker did not report a reason. Check the worker log.'}</AlertDescription>
            </Alert>
          )}
          <ReviewTimeline reviewId={r!.id} status={r!.status} />
          {r!.summary && (
            <Card>
              <CardHeader>
                <CardDescription>Summary</CardDescription>
                <CardTitle className='text-base font-normal'>{r!.summary}</CardTitle>
              </CardHeader>
            </Card>
          )}

          {r!.status === 'completed' && r!.findings.length === 0 && (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyTitle>No issues found</EmptyTitle>
                <EmptyDescription>The reviewer did not report anything on this change.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {r!.findings.length > 0 && (
            <>
              <div className='flex flex-wrap items-center gap-2' role='group' aria-label='Filter findings by severity'>
                <Button size='sm' variant={filter === 'all' ? 'default' : 'outline'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                  All ({r!.findings.length})
                </Button>
                {counts.map((c) => (
                  <Button
                    key={c.severity}
                    size='sm'
                    variant={filter === c.severity ? 'default' : 'outline'}
                    aria-pressed={filter === c.severity}
                    className='capitalize'
                    onClick={() => setFilter(c.severity)}
                  >
                    {c.severity} ({c.n})
                  </Button>
                ))}
              </div>
              {[...byFile.entries()].map(([file, items]) => (
                <Card key={file} className='gap-0 py-0'>
                  <CardHeader className='bg-muted/40 border-b py-3'>
                    <CardTitle className='flex items-center gap-2 font-mono text-sm font-medium break-all'>
                      <IconFile className='size-4 shrink-0' />
                      {file}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='px-0'>
                    <ul>
                      {items.map((f) => (
                        <FindingCard key={f.id} finding={f} />
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}
