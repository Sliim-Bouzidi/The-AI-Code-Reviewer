import type { IndexStatus, ReviewStatus, Severity } from '@codereview/shared';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

// Severity is always shown as text; the colour only reinforces it.
const SEVERITY_CLASS: Record<Severity, string> = {
  critical: 'border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-400',
  high: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  low: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  info: 'border-border bg-muted text-muted-foreground',
};
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function SeverityBadge({ severity, count }: { severity: Severity; count?: number }) {
  return (
    <Badge variant='outline' className={cn('capitalize', SEVERITY_CLASS[severity])}>
      {count != null && <span className='tabular-nums'>{count}</span>}
      {severity}
    </Badge>
  );
}

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  if (status === 'queued' || status === 'running') {
    return (
      <Badge variant='secondary' className='capitalize'>
        <Spinner className='size-3' />
        {status}
      </Badge>
    );
  }
  if (status === 'failed') return <Badge variant='destructive'>Failed</Badge>;
  return <Badge variant='outline'>Completed</Badge>;
}

const INDEX_LABEL: Record<IndexStatus, string> = {
  none: 'Not indexed',
  indexing: 'Indexing',
  ready: 'Indexed',
  failed: 'Index failed',
};
export function IndexStatusBadge({ status }: { status: IndexStatus }) {
  return (
    <Badge variant={status === 'failed' ? 'destructive' : status === 'ready' ? 'outline' : 'secondary'}>
      {status === 'indexing' && <Spinner className='size-3' />}
      {INDEX_LABEL[status]}
    </Badge>
  );
}
