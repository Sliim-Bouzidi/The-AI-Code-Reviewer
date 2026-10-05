import { describe, expect, it } from 'vitest';
import { ratio, scoreCase } from './scoring.js';
import type { EvalSpec } from './scoring.js';

const spec: EvalSpec = {
  expected: [
    { file: 'a.ts', lines: [10, 12], issue: 'SQL injection' },
    { file: 'a.ts', lines: [30, 30], issue: 'off by one' },
  ],
};

describe('scoreCase', () => {
  it('counts caught issues, on-target findings and what was missed', () => {
    const s = scoreCase(spec, [
      { filePath: 'a.ts', lineStart: 11, lineEnd: null, severity: 'critical' }, // hit
      { filePath: 'a.ts', lineStart: 50, lineEnd: null, severity: 'low' }, // extra
      { filePath: 'b.ts', lineStart: 30, lineEnd: null, severity: 'high' }, // wrong file
    ]);
    expect(s).toMatchObject({ expected: 2, caught: 1, findings: 3, onTarget: 1, falseAlarms: 0 });
    expect(s.missed).toEqual(['off by one']);
  });

  it('accepts findings within 2 lines of the expected range', () => {
    expect(scoreCase(spec, [{ filePath: 'a.ts', lineStart: 32, lineEnd: null, severity: 'high' }]).caught).toBe(1);
    expect(scoreCase(spec, [{ filePath: 'a.ts', lineStart: 33, lineEnd: null, severity: 'high' }]).caught).toBe(0);
  });

  it('counts findings above the allowed severity on a clean case as false alarms', () => {
    const clean: EvalSpec = { expected: [], max_severity_ok: 'low' };
    const s = scoreCase(clean, [
      { filePath: 'f.ts', lineStart: 1, lineEnd: null, severity: 'low' },
      { filePath: 'f.ts', lineStart: 2, lineEnd: null, severity: 'high' },
    ]);
    expect(s.falseAlarms).toBe(1);
  });

  it('ratio is null when there is nothing to divide by', () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(7, 9)).toBeCloseTo(0.778, 3);
  });
});
