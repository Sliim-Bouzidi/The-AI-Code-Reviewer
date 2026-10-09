import { execFile } from 'node:child_process';
import { relative } from 'node:path';
import type { CandidateFinding, Severity } from '@codereview/shared';
import { log } from '../deps.js';

const SEVERITY: Record<string, Severity> = { ERROR: 'high', WARNING: 'medium', INFO: 'low' };

/**
 * Runs the Semgrep CLI on a directory holding the changed files and maps the results to findings.
 * Returns [] (with a warning) when Semgrep is not installed, so the demo still works without it.
 */
export function runSemgrep(dir: string): Promise<CandidateFinding[]> {
  const config = process.env.SEMGREP_CONFIG ?? 'auto';
  return new Promise((resolve) => {
    execFile(
      'semgrep',
      ['scan', '--config', config, '--json', '--quiet', '--metrics', config === 'auto' ? 'on' : 'off', dir],
      { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          log('semgrep', 'skipped', { reason: (err as NodeJS.ErrnoException).code ?? 'failed' });
          return resolve([]);
        }
        try {
          const results = (JSON.parse(stdout).results ?? []) as any[];
          resolve(
            results.map((r) => ({
              filePath: relative(dir, r.path).split('\\').join('/'),
              lineStart: r.start.line,
              lineEnd: r.end.line > r.start.line ? r.end.line : null,
              severity: SEVERITY[r.extra?.severity] ?? 'medium',
              category: r.extra?.metadata?.category === 'security' ? 'security' : 'bug',
              source: 'semgrep' as const,
              message: `${r.extra?.message ?? r.check_id} (${r.check_id})`,
              suggestion: r.extra?.fix ?? null,
              confidence: 0.9,
              ruleId: r.check_id ?? 'semgrep-rule',
            })),
          );
        } catch {
          log('semgrep', 'unparseable output');
          resolve([]);
        }
      },
    );
  });
}
