'use client';

import { IconRefresh } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage, useApi } from '@/lib/api';

/**
 * "Re-run review": reviews the pull request again on its latest commit, posts a fresh review on
 * GitHub, and opens the new review so its live timeline shows. `icon` = compact, for table rows.
 */
export function RerunReviewButton({ reviewId, icon = false }: { reviewId: string; icon?: boolean }) {
  const api = useApi();
  const qc = useQueryClient();
  const router = useRouter();
  const rerun = useMutation({
    mutationFn: () => api.rerunReview(reviewId),
    onSuccess: ({ reviewId: next }) => {
      toast.success('Review queued: a fresh review will be posted on the pull request.');
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      router.push(`/dashboard/reviews/${next}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const spin = rerun.isPending ? 'animate-spin' : undefined;

  if (icon) {
    return (
      <Button
        variant='ghost'
        size='icon'
        className='size-8'
        title='Re-run review'
        aria-label='Re-run review'
        disabled={rerun.isPending}
        onClick={() => rerun.mutate()}
      >
        <IconRefresh className={spin} />
      </Button>
    );
  }
  return (
    <Button variant='outline' size='sm' disabled={rerun.isPending} onClick={() => rerun.mutate()}>
      <IconRefresh className={spin} />
      {rerun.isPending ? 'Queuing…' : 'Re-run review'}
    </Button>
  );
}
