import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { App } from '@octokit/app';
import { requireGithubAppConfig } from '@codereview/db';
import type { Db } from '@codereview/db';
import type { CandidateFinding } from '@codereview/shared';

let db: Db;
/** Must be called once at startup: the GitHub App credentials are read from the database. */
export function initGithub(database: Db): void {
  db = database;
}

let app: { id: string; instance: App } | null = null;
async function getApp(): Promise<App> {
  const config = await requireGithubAppConfig(db);
  if (!app || app.id !== config.appId) {
    app = { id: config.appId, instance: new App({ appId: config.appId, privateKey: config.privateKey }) };
  }
  return app.instance;
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
  const octokit = await (await getApp()).getInstallationOctokit(installationId);
  const auth = (await octokit.auth({ type: 'installation' })) as { token: string };
  return auth.token;
}

export async function fetchPrDiff(ref: RepoRef, prNumber: number): Promise<string> {
  const octokit = await (await getApp()).getInstallationOctokit(ref.installationId);
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
  const octokit = await (await getApp()).getInstallationOctokit(ref.installationId);
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

// ---- visibility on the PR: an "eyes" reaction and a "AI Code Review" check run.
// Both are best-effort: an older GitHub App without the `checks` permission must not break reviews.

export async function reactToPr(ref: RepoRef, prNumber: number): Promise<void> {
  try {
    const octokit = await (await getApp()).getInstallationOctokit(ref.installationId);
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/reactions', {
      owner: ref.owner,
      repo: ref.repo,
      issue_number: prNumber,
      content: 'eyes',
    });
  } catch {
    // ignore
  }
}

export async function startCheckRun(ref: RepoRef, headSha: string): Promise<number | null> {
  try {
    const octokit = await (await getApp()).getInstallationOctokit(ref.installationId);
    const res = await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
      owner: ref.owner,
      repo: ref.repo,
      name: 'AI Code Review',
      head_sha: headSha,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      output: { title: 'Review in progress', summary: 'The AI reviewer is analysing this pull request…' },
    });
    return Number(res.data.id);
  } catch {
    return null;
  }
}

export async function updateCheckRun(
  ref: RepoRef,
  checkRunId: number,
  update: { progress?: string; conclusion?: 'success' | 'neutral' | 'failure'; title?: string; summary?: string },
): Promise<void> {
  try {
    const octokit = await (await getApp()).getInstallationOctokit(ref.installationId);
    await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
      owner: ref.owner,
      repo: ref.repo,
      check_run_id: checkRunId,
      ...(update.conclusion
        ? { status: 'completed' as const, conclusion: update.conclusion, completed_at: new Date().toISOString() }
        : {}),
      output: {
        title: update.title ?? 'Review in progress',
        summary: update.summary ?? update.progress ?? '',
      },
    });
  } catch {
    // ignore
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
  const octokit = await (await getApp()).getInstallationOctokit(ref.installationId);
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
