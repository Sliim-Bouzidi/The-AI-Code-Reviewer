import { describe, expect, it } from 'vitest';
import type { GeneratedTestSummaryDto } from '@codereview/shared';

export function computeTestGenerationStats(tests: GeneratedTestSummaryDto[]) {
  return {
    total: tests.length,
    passedCount: tests.filter((t) => t.status === 'PASSED').length,
    failedCount: tests.filter((t) => t.status === 'FAILED').length,
    compileErrCount: tests.filter((t) => t.status === 'REJECTED').length,
    timeoutCount: tests.filter((t) => t.status === 'TIMEOUT').length,
  };
}

export function isGenerationActive(status: string): boolean {
  return ['pending', 'generating', 'validating'].includes(status);
}

describe('Test Generation Frontend Helpers (Phase 8)', () => {
  it('1. Correctly identifies active generation statuses', () => {
    expect(isGenerationActive('pending')).toBe(true);
    expect(isGenerationActive('generating')).toBe(true);
    expect(isGenerationActive('validating')).toBe(true);
    expect(isGenerationActive('completed')).toBe(false);
    expect(isGenerationActive('failed')).toBe(false);
  });

  it('2. Computes correct stats breakdown for generated tests', () => {
    const mockTests: GeneratedTestSummaryDto[] = [
      {
        id: 't-1',
        sourceFile: 'src/Calculator.java',
        className: 'Calculator',
        methodName: 'add',
        testClassName: 'CalculatorTest',
        status: 'PASSED',
        compileSuccess: true,
        testSuccess: true,
        durationMs: 100,
        postedToGithub: false,
        createdAt: new Date(),
      },
      {
        id: 't-2',
        sourceFile: 'src/Calculator.java',
        className: 'Calculator',
        methodName: 'divide',
        testClassName: 'CalculatorTest',
        status: 'FAILED',
        compileSuccess: true,
        testSuccess: false,
        durationMs: 150,
        postedToGithub: false,
        createdAt: new Date(),
      },
      {
        id: 't-3',
        sourceFile: 'src/Calculator.java',
        className: 'Calculator',
        methodName: 'multiply',
        testClassName: 'CalculatorTest',
        status: 'REJECTED',
        compileSuccess: false,
        testSuccess: false,
        durationMs: 50,
        postedToGithub: false,
        createdAt: new Date(),
      },
      {
        id: 't-4',
        sourceFile: 'src/Calculator.java',
        className: 'Calculator',
        methodName: 'slowOperation',
        testClassName: 'CalculatorTest',
        status: 'TIMEOUT',
        compileSuccess: true,
        testSuccess: false,
        durationMs: 5000,
        postedToGithub: false,
        createdAt: new Date(),
      },
    ];

    const stats = computeTestGenerationStats(mockTests);
    expect(stats.total).toBe(4);
    expect(stats.passedCount).toBe(1);
    expect(stats.failedCount).toBe(1);
    expect(stats.compileErrCount).toBe(1);
    expect(stats.timeoutCount).toBe(1);
  });

  it('3. Handles empty test list gracefully', () => {
    const stats = computeTestGenerationStats([]);
    expect(stats.total).toBe(0);
    expect(stats.passedCount).toBe(0);
    expect(stats.failedCount).toBe(0);
    expect(stats.compileErrCount).toBe(0);
    expect(stats.timeoutCount).toBe(0);
  });
});
