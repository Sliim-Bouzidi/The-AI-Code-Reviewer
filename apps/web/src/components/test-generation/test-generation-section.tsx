'use client';

import type { GeneratedTestSummaryDto } from '@codereview/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApi } from '@/lib/api';
import { GeneratedTestDialog } from './generated-test-dialog';

export interface TestGenerationSectionProps {
  prId: string;
}

export function TestGenerationSection({ prId }: TestGenerationSectionProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [selectedTestId, setSelectedTestId] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // 1. Fetch generations list for PR
  const generationsQuery = useQuery({
    queryKey: ['test-generations', prId],
    queryFn: () => api.testGenerations(prId),
    enabled: !!prId,
  });

  const latestGen = generationsQuery.data?.[0] ?? null;

  // Active status check: pending | generating | validating
  const isActive = latestGen && ['pending', 'generating', 'validating'].includes(latestGen.status);

  // 2. Poll status while generation is active
  const statusQuery = useQuery({
    queryKey: ['test-generation-status', latestGen?.id],
    queryFn: () => (latestGen ? api.testGenerationStatus(latestGen.id) : null),
    enabled: !!latestGen && !!isActive,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      // Stop polling when completed or failed
      if (['completed', 'failed'].includes(data.status)) {
        // Refetch full details once completed
        queryClient.invalidateQueries({ queryKey: ['test-generations', prId] });
        queryClient.invalidateQueries({ queryKey: ['test-generation-details', latestGen?.id] });
        return false;
      }
      return 2000;
    },
  });

  // 3. Fetch full details (including test cases) for latest generation
  const detailsQuery = useQuery({
    queryKey: ['test-generation-details', latestGen?.id],
    queryFn: () => (latestGen ? api.testGenerationDetails(latestGen.id) : null),
    enabled: !!latestGen,
  });

  // 4. Trigger manual test generation mutation
  const triggerMutation = useMutation({
    mutationFn: () => api.triggerTestGeneration(prId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-generations', prId] });
    },
  });

  const handleTestClick = (testId: string) => {
    setSelectedTestId(testId);
    setDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PASSED':
        return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">✓ PASSED</Badge>;
      case 'FAILED':
      case 'TEST_FAILURE':
        return <Badge variant="destructive">✗ FAILED</Badge>;
      case 'REJECTED':
      case 'COMPILE_ERROR':
        return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">⚠ COMPILE ERROR</Badge>;
      case 'TIMEOUT':
        return <Badge variant="outline" className="border-amber-500 text-amber-600">⌛ TIMEOUT</Badge>;
      case 'GENERATING':
      case 'VALIDATING':
        return <Badge variant="secondary" className="gap-1"><Spinner className="size-3" /> {status}</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (generationsQuery.isPending) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <Spinner className="mr-2 size-5" />
          <span className="text-muted-foreground text-sm">Loading test generations...</span>
        </CardContent>
      </Card>
    );
  }

  if (generationsQuery.isError) {
    return (
      <Card className="border-destructive/50 bg-destructive/10">
        <CardContent className="flex items-center justify-between p-4">
          <span className="text-destructive text-sm font-medium">
            Unable to load test generations: {generationsQuery.error.message}
          </span>
          <Button size="sm" variant="outline" onClick={() => generationsQuery.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Empty State: No generations yet
  if (!latestGen) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Automatic Test Generation</CardTitle>
          <CardDescription>Generate and validate JUnit 5 + Mockito unit tests for modified Java methods.</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No automatic tests generated yet</EmptyTitle>
              <EmptyDescription>Trigger test generation to automatically produce and validate JUnit 5 tests for Java methods in this PR.</EmptyDescription>
            </EmptyHeader>
            <Button
              className="mt-4"
              disabled={triggerMutation.isPending}
              onClick={() => triggerMutation.mutate()}
            >
              {triggerMutation.isPending && <Spinner className="mr-2 size-4" />}
              Generate Tests
            </Button>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const details = detailsQuery.data;
  const progress = statusQuery.data?.progress;
  const generatedTestsList = details?.generatedTests ?? [];

  // Compute statistics
  const total = generatedTestsList.length;
  const passedCount = generatedTestsList.filter((t: GeneratedTestSummaryDto) => t.status === 'PASSED').length;
  const failedCount = generatedTestsList.filter((t: GeneratedTestSummaryDto) => t.status === 'FAILED').length;
  const compileErrCount = generatedTestsList.filter((t: GeneratedTestSummaryDto) => t.status === 'REJECTED').length;
  const timeoutCount = generatedTestsList.filter((t: GeneratedTestSummaryDto) => t.status === 'TIMEOUT').length;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-lg font-medium">Automatic Test Generation</CardTitle>
            <CardDescription className="text-xs">
              Commit SHA: <code className="font-mono">{latestGen.headSha.slice(0, 7)}</code> — Status: {latestGen.status}
            </CardDescription>
          </div>
          <Button
            size="sm"
            disabled={isActive || triggerMutation.isPending}
            onClick={() => triggerMutation.mutate()}
          >
            {(isActive || triggerMutation.isPending) && <Spinner className="mr-2 size-3" />}
            {isActive ? 'Generating...' : 'Generate Tests'}
          </Button>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {/* Active Generation Progress */}
          {isActive && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-3">
                <Spinner className="size-5 text-primary" />
                <div>
                  <div className="font-medium text-sm">Generating and Validating JUnit 5 Tests...</div>
                  <div className="text-muted-foreground text-xs">
                    {progress
                      ? `${progress.completed} of ${progress.total} methods completed (${progress.passed} passed)`
                      : 'Extracting Java context and invoking LLM...'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stats Bar */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="bg-muted/40 rounded-lg p-3 text-center">
              <div className="text-muted-foreground text-xs font-medium">Total Methods</div>
              <div className="text-xl font-bold">{total}</div>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-3 text-center">
              <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Passed</div>
              <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{passedCount}</div>
            </div>
            <div className="rounded-lg bg-destructive/10 p-3 text-center">
              <div className="text-destructive text-xs font-medium">Test Failure</div>
              <div className="text-destructive text-xl font-bold">{failedCount}</div>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-3 text-center">
              <div className="text-xs font-medium text-amber-600 dark:text-amber-400">Compile Error</div>
              <div className="text-xl font-bold text-amber-700 dark:text-amber-300">{compileErrCount}</div>
            </div>
            <div className="bg-muted/60 rounded-lg p-3 text-center">
              <div className="text-muted-foreground text-xs font-medium">Timeout</div>
              <div className="text-xl font-bold">{timeoutCount}</div>
            </div>
          </div>

          {/* Generated Tests Table */}
          {generatedTestsList.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source File / Class</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Test Class</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {generatedTestsList.map((t: GeneratedTestSummaryDto) => (
                    <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleTestClick(t.id)}>
                      <TableCell className="font-mono text-xs font-medium">
                        {t.className}
                        <div className="text-muted-foreground font-normal text-[11px] truncate max-w-[200px]">{t.sourceFile}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{t.methodName}()</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{t.testClassName}</TableCell>
                      <TableCell>{getStatusBadge(t.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleTestClick(t.id); }}>
                          View Code
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : !isActive && (
            <div className="text-muted-foreground text-center text-xs py-4">
              No tests were generated in this run.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <GeneratedTestDialog
        testId={selectedTestId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
