'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';

export default function Providers({ children, publishableKey }: { children: React.ReactNode; publishableKey: string | null }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            // an unreachable API or a 401/404 will not fix itself on retry
            retry: (count, err) => !(err instanceof ApiError) && count < 2,
          },
        },
      }),
  );
  return (
    <AuthProvider publishableKey={publishableKey}>
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}
