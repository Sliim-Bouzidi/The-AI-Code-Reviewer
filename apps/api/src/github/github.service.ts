import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { App } from '@octokit/app';
import { eq, inArray, installations, repositories } from '@codereview/db';
import type { Db } from '@codereview/db';
import { requireEnv } from '@codereview/shared';
import { DB } from '../common/db.module.js';

@Injectable()
export class GithubService {
  private app: App | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  private getApp(): App {
    this.app ??= new App({
      appId: requireEnv('GITHUB_APP_ID'),
      privateKey: requireEnv('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n'),
    });
    return this.app;
  }

  // ---- webhook signature (X-Hub-Signature-256)
  verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!rawBody || !signature) return false;
    const expected = 'sha256=' + createHmac('sha256', requireEnv('GITHUB_WEBHOOK_SECRET')).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ---- "Connect GitHub": `state` ties the GitHub redirect back to the logged-in user
  private sign(value: string): string {
    return createHmac('sha256', requireEnv('GITHUB_WEBHOOK_SECRET')).update(`state:${value}`).digest('hex').slice(0, 32);
  }
  installUrl(userId: string): string {
    const state = `${userId}.${this.sign(userId)}`;
    return `https://github.com/apps/${requireEnv('GITHUB_APP_SLUG')}/installations/new?state=${state}`;
  }
  userIdFromState(state: string | undefined): string | null {
    const [userId, sig] = (state ?? '').split('.');
    return userId && sig && sig === this.sign(userId) ? userId : null;
  }

  /** Stores (or updates) an installation and its repo list. `userId` is only known in the callback. */
  async syncInstallation(githubInstallationId: number, userId?: string): Promise<void> {
    const octokit = await this.getApp().getInstallationOctokit(githubInstallationId);
    const { data: inst } = await this.getApp().octokit.request('GET /app/installations/{installation_id}', {
      installation_id: githubInstallationId,
    });
    const login = (inst.account as { login?: string } | null)?.login ?? 'unknown';
    const [row] = await this.db
      .insert(installations)
      .values({ githubInstallationId, accountLogin: login, userId })
      .onConflictDoUpdate({
        target: installations.githubInstallationId,
        set: { accountLogin: login, ...(userId ? { userId } : {}) },
      })
      .returning();

    const repos: { id: number; full_name: string; default_branch: string }[] = [];
    for (let page = 1; page <= 5; page++) {
      const { data } = await octokit.request('GET /installation/repositories', { per_page: 100, page });
      repos.push(...data.repositories.map((r) => ({ id: Number(r.id), full_name: r.full_name, default_branch: r.default_branch })));
      if (data.repositories.length < 100) break;
    }
    for (const r of repos) {
      await this.db
        .insert(repositories)
        .values({ installationId: row!.id, githubRepoId: r.id, fullName: r.full_name, defaultBranch: r.default_branch })
        .onConflictDoUpdate({
          target: repositories.githubRepoId,
          set: { fullName: r.full_name, defaultBranch: r.default_branch, installationId: row!.id },
        });
    }
    // repos the app no longer has access to
    const current = await this.db.select().from(repositories).where(eq(repositories.installationId, row!.id));
    const gone = current.filter((c) => !repos.some((r) => r.id === c.githubRepoId)).map((c) => c.id);
    if (gone.length > 0) await this.db.delete(repositories).where(inArray(repositories.id, gone));
  }

  async removeInstallation(githubInstallationId: number): Promise<void> {
    await this.db.delete(installations).where(eq(installations.githubInstallationId, githubInstallationId));
  }
}
