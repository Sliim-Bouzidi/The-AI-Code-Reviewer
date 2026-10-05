import type { Review } from '@codereview/shared';
import Link from 'next/link';
import { ReviewStatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDuration, timeAgo } from '@/lib/utils';

export function ReviewsTable({ reviews, repoNames }: { reviews: Review[]; repoNames?: Record<string, string> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Review</TableHead>
          {repoNames && <TableHead>Repository</TableHead>}
          <TableHead>Status</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className='text-right'>Duration</TableHead>
          <TableHead className='text-right'>When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviews.map((r) => {
          const title = r.prNumber != null ? `#${r.prNumber} ${r.prTitle ?? ''}` : 'Local diff review';
          return (
          <TableRow key={r.id}>
            <TableCell>
              {/* table cells ignore max-width, so the limit sits on the content; full title on hover */}
              <Link
                href={`/dashboard/reviews/${r.id}`}
                title={title}
                className='block max-w-[18rem] truncate font-medium underline-offset-4 hover:underline md:max-w-[24rem] xl:max-w-[32rem]'
              >
                {title}
              </Link>
              <div className='text-muted-foreground max-w-[18rem] truncate text-xs md:max-w-[24rem] xl:max-w-[32rem]'>
                {r.status === 'failed' ? r.error : (r.summary ?? 'No summary yet')}
              </div>
            </TableCell>
            {repoNames && <TableCell className='whitespace-nowrap'>{r.repoId ? repoNames[r.repoId] : '-'}</TableCell>}
            <TableCell>
              <ReviewStatusBadge status={r.status} />
            </TableCell>
            <TableCell>
              <Badge variant='secondary'>{r.trigger === 'webhook' ? 'Pull request' : 'MCP'}</Badge>
            </TableCell>
            <TableCell className='text-right tabular-nums'>{formatDuration(r.durationMs)}</TableCell>
            <TableCell className='text-muted-foreground text-right whitespace-nowrap'>{timeAgo(r.createdAt)}</TableCell>
          </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
