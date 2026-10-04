import { IconAlertTriangle } from '@tabler/icons-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';

export function LoadError({ error }: { error: unknown }) {
  return (
    <Alert variant='destructive'>
      <IconAlertTriangle />
      <AlertTitle>Could not load this</AlertTitle>
      <AlertDescription>{errorMessage(error)}</AlertDescription>
    </Alert>
  );
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className='flex flex-col gap-2' role='status' aria-label='Loading'>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className='h-10 w-full' />
      ))}
    </div>
  );
}
