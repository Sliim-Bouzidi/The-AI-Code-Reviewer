import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getInstallationToken } from './github.js';

const exec = promisify(execFile);

/**
 * Shallow-clones `fullName` (default branch, or `branch`) into the empty directory `dir` with the GitHub App's
 * short-lived installation token, and returns the commit that was checked out. Shared by the indexer and the
 * structure analysis. The token travels as an HTTP header, so it never lands in the clone's .git/config.
 *
 * Errors are rewritten on purpose: the raw error of `execFile` contains the whole command line, token included,
 * and these messages end up in logs and in the dashboard.
 */
export async function cloneRepository(installationId: number, fullName: string, dir: string, branch?: string): Promise<string> {
  const token = await getInstallationToken(installationId);
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  try {
    await exec(
      'git',
      [
        '-c', `http.extraHeader=Authorization: Basic ${basic}`,
        'clone', '--depth', '1',
        ...(branch ? ['--branch', branch] : []),
        `https://github.com/${fullName}.git`, dir,
      ],
      { timeout: 300_000 },
    );
  } catch (err) {
    const e = err as { killed?: boolean; stderr?: unknown; message: string };
    const raw = e.killed ? 'timed out' : (String(e.stderr ?? '').trim().split('\n').filter(Boolean).pop() ?? e.message);
    throw new Error(`git clone failed: ${raw.split(basic).join('***').split(token).join('***').slice(0, 200)}`);
  }
  return (await exec('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();
}
