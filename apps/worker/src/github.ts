import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { App } from '@octokit/app';
import { requireEnv } from '@codereview/shared';
import type { CandidateFinding } from '@codereview/shared';

let app: App | null = null;
function getApp(): App {
  app ??= new App({
    appId: requireEnv('GITHUB_APP_ID'),
    privateKey: requireEnv('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n'),
  });
  return app;
}

export interface RepoRef {
  installationId: number;
  owner: string;
  repo: string;
}

export function repoRef(installationId: number, fullName: string): RepoRef {
  const [owner, repo] = fullName.split('/') as [string, string];
  return { installationId, owner, repo };
}

/** Short-lived installation token (about 1 hour). Used for cloning. Never log it. */
export async function getInstallationToken(installationId: number): Promise<string> {
  const octokit = await getApp().getInstallationOctokit(installationId);
  const auth = (await octokit.auth({ type: 'installation' })) as { token: string };
  return auth.token;
}

export async function fetchPrDiff(ref: RepoRef, prNumber: number): Promise<string> {
  const octokit = await getApp().getInstallationOctokit(ref.installationId);
  const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner: ref.owner,
    repo: ref.repo,
    pull_number: prNumber,
    mediaType: { format: 'diff' },
  });
  return res.data as unknown as string;
}

/** Downloads the given files at `sha` into `dir` (for Semgrep). Files that fail are skipped. */
export async function downloadFiles(ref: RepoRef, sha: string, paths: string[], dir: string): Promise<void> {
  const octokit = await getApp().getInstallationOctokit(ref.installationId);
  for (const path of paths) {
    try {
      const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: ref.owner,
        repo: ref.repo,
        path,
        ref: sha,
        mediaType: { format: 'raw' },
      });
      const target = join(dir, path);
      if (!target.startsWith(dir)) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, res.data as unknown as string);
    } catch {
      // too large or removed: Semgrep simply does not see it
    }
  }
}

const BADGE: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: '⚪' };

export function formatComment(f: CandidateFinding): string {
  let body = `${BADGE[f.severity] ?? ''} **${f.severity}** · ${f.category}\n\n${f.message}`;
  if (f.suggestion) body += `\n\n**Suggestion:** ${f.suggestion}`;
  if (f.source === 'semgrep') body += '\n\n<sub>Found by Semgrep</sub>';
  return body;
}

/** Step 9: one PR review with inline comments. Returns the GitHub review id. */
export async function postReview(
  ref: RepoRef,
  prNumber: number,
  headSha: string,
  summary: string,
  findings: CandidateFinding[],
): Promise<number> {
  const octokit = await getApp().getInstallationOctokit(ref.installationId);
  const res = await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
    owner: ref.owner,
    repo: ref.repo,
    pull_number: prNumber,
    commit_id: headSha,
    event: 'COMMENT',
    body: summary,
    comments: findings.map((f) => ({
      path: f.filePath,
      side: 'RIGHT',
      line: f.lineEnd ?? f.lineStart,
      ...(f.lineEnd ? { start_line: f.lineStart, start_side: 'RIGHT' } : {}),
      body: formatComment(f),
    })),
  });
  return Number(res.data.id);
}
