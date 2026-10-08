'use client';

import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useApi } from '@/lib/api';

export interface GeneratedTestDialogProps {
  testId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GeneratedTestDialog({ testId, open, onOpenChange }: GeneratedTestDialogProps) {
  const api = useApi();

  const testQuery = useQuery({
    queryKey: ['generated-test', testId],
    queryFn: () => (testId ? api.generatedTest(testId) : null),
    enabled: !!testId && open,
  });

  const t = testQuery.data;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PASSED':
        return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">✓ PASSED</Badge>;
      case 'FAILED':
      case 'TEST_FAILURE':
        return <Badge variant="destructive">✗ TEST FAILURE</Badge>;
      case 'REJECTED':
      case 'COMPILE_ERROR':
        return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">⚠ COMPILE ERROR</Badge>;
      case 'TIMEOUT':
        return <Badge variant="outline" className="border-amber-500 text-amber-600">⌛ TIMEOUT</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-mono">
            {t ? `${t.className}.${t.methodName}` : 'Generated Test Case'}
            {t && getStatusBadge(t.status)}
          </DialogTitle>
          <DialogDescription>
            {t ? `File: ${t.sourceFile} — Generated Test Class: ${t.testClassName}` : 'Loading test details...'}
          </DialogDescription>
        </DialogHeader>

        {testQuery.isPending ? (
          <div className="flex items-center justify-center p-8">
            <Spinner className="size-6" />
          </div>
        ) : testQuery.isError ? (
          <div className="text-destructive p-4 text-sm">
            Failed to load generated test details: {testQuery.error.message}
          </div>
        ) : t ? (
          <div className="flex flex-col gap-4">
            {t.compileError && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="mb-1 font-semibold text-amber-600 text-xs dark:text-amber-400">
                  Compilation Error Details
                </div>
                <pre className="font-mono text-xs whitespace-pre-wrap text-amber-700 dark:text-amber-300">
                  {t.compileError}
                </pre>
              </div>
            )}

            {t.executionError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                <div className="text-destructive mb-1 font-semibold text-xs">
                  Execution Error / Failure Details
                </div>
                <pre className="text-destructive font-mono text-xs whitespace-pre-wrap">
                  {t.executionError}
                </pre>
              </div>
            )}

            {t.testCode ? (
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium">Generated JUnit 5 Code</div>
                <pre className="bg-muted text-foreground overflow-x-auto rounded-lg p-4 font-mono text-xs leading-relaxed whitespace-pre">
                  {t.testCode}
                </pre>
              </div>
            ) : (
              <div className="text-muted-foreground text-xs italic">No code generated yet for this test.</div>
            )}

            {t.executionOutput && (
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium">Execution Output (stdout)</div>
                <pre className="bg-muted text-muted-foreground overflow-x-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">
                  {t.executionOutput}
                </pre>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
