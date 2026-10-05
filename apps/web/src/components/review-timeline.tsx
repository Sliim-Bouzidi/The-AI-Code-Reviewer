'use client';

import { IconCheck, IconCircleDashed, IconPlayerSkipForward, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useApi } from '@/lib/api';
import type { ReviewEvent } from '@/lib/api';
import { formatDuration } from '@/lib/utils';

const STAGES: { id: string; label: string; hint: string }[] = [
  { id: 'fetch', label: 'Fetch diff', hint: 'Download the pull request diff and drop lockfiles / ignored paths' },
  { id: 'parse', label: 'Parse changed code', hint: 'Tree-sitter finds the functions touched by the diff and what they call' },
  { id: 'static_analysis', label: 'Static analysis', hint: 'Semgrep rules on the changed files' },
  { id: 'context', label: 'Codebase context', hint: 'Similar code from the pgvector index' },
  { id: 'llm', label: 'LLM review', hint: 'One model call per file, strict JSON output' },
  { id: 'validate', label: 'Validate & rank', hint: 'Check line numbers, merge duplicates, apply strictness' },
  { id: 'post', label: 'Post to GitHub', hint: 'One PR review with inline comments + check run' },
];

/** The latest event of each stage wins (a stage emits running, then done / failed). */
function latestByStage(items: ReviewEvent[]) {
  const map = new Map<string, ReviewEvent>();
  for (const e of items) map.set(e.stage, e);
  return map;
}

function StageIcon({ status }: { status: ReviewEvent['status'] | 'pending' }) {
  if (status === 'running') return <Spinner className='size-4' />;
  if (status === 'done') return <IconCheck className='size-4 text-emerald-500' />;
  if (status === 'failed') return <IconX className='size-4 text-red-500' />;
  if (status === 'skipped') return <IconPlayerSkipForward className='text-muted-foreground size-4' />;
  return <IconCircleDashed className='text-muted-foreground size-4' />;
}

/** Live pipeline view: polls once a second while the review is queued/running. */
export function ReviewTimeline({ reviewId, status }: { reviewId: string; status: string }) {
  const api = useApi();
  const active = status === 'queued' || status === 'running';
  const events = useQuery({
    queryKey: ['review-events', reviewId],
    queryFn: () => api.reviewEvents(reviewId),
    refetchInterval: (q) => (active || q.state.data?.status === 'running' || q.state.data?.status === 'queued' ? 1_000 : false),
  });
  const byStage = latestByStage(events.data?.items ?? []);
  if (!events.data || events.data.items.length === 0) {
    return active ? (
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Spinner className='size-4' /> Waiting for the worker…
          </CardTitle>
          <CardDescription>The review is queued. Steps appear here as soon as the worker picks it up.</CardDescription>
        </CardHeader>
      </Card>
    ) : null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Pipeline</CardTitle>
        <CardDescription>What the reviewer did, step by step.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className='flex flex-col gap-3'>
          {STAGES.map((s) => {
            const e = byStage.get(s.id);
            return (
              <li key={s.id} className='flex items-start gap-3'>
                <span className='mt-0.5'>
                  <StageIcon status={e?.status ?? 'pending'} />
                </span>
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-baseline gap-x-2'>
                    <span className='text-sm font-medium'>{s.label}</span>
                    {e?.durationMs != null && (
                      <span className='text-muted-foreground text-xs tabular-nums'>{formatDuration(e.durationMs)}</span>
                    )}
                  </div>
                  <p className='text-muted-foreground text-xs'>{e?.detail ?? s.hint}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
