import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { App } from '@octokit/app';
import {
  clearGithubAppCache, eq, getGithubAppConfig, githubApp, inArray, installations, repositories, requireGithubAppConfig,
} from '@codereview/db';
import type { Db } from '@codereview/db';
import { DB } from '../common/db.module.js';

/** Signs the `state` parameter of GitHub redirects. Random per boot: the flows last a few minutes. */
const STATE_SECRET = process.env.STATE_SECRET ?? randomBytes(32).toString('hex');

@Injectable()
export class GithubService {
  private app: { id: string; instance: App } | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  private async getApp(): Promise<App> {
    const config = await requireGithubAppConfig(this.db);
    if (!this.app || this.app.id !== config.appId) {
      this.app = { id: config.appId, instance: new App({ appId: config.appId, privateKey: config.privateKey }) };
    }
    return this.app.instance;
  }

  // ---- webhook signature (X-Hub-Signature-256)
  async verifySignature(rawBody: Buffer | undefined, signature: string | undefined): Promise<boolean> {
    const config = await getGithubAppConfig(this.db);
    if (!config || !rawBody || !signature) return false;
    const expected = 'sha256=' + createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ---- setup status, used by the dashboard wizard
  /** Public URL GitHub should send webhooks to (smee channel from the compose stack, or WEBHOOK_URL). */
  webhookUrl(): string | null {
    if (process.env.WEBHOOK_URL) return process.env.WEBHOOK_URL;
    if (process.env.SMEE_URL) return process.env.SMEE_URL;
    try {
      const url = readFileSync(process.env.SMEE_FILE ?? '/data/smee-url', 'utf8').trim();
      return url || null;
    } catch {
      return null;
    }
  }

  apiPublicUrl(): string {
    return (process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`).replace(/\/$/, '');
  }

  async setupStatus() {
    const config = await getGithubAppConfig(this.db);
    return {
      githubAppConfigured: !!config,
      appSlug: config?.slug || null,
      webhookUrl: this.webhookUrl(),
      llmConfigured: !!(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY),
    };
  }

  // ---- one-click GitHub App creation (GitHub "manifest" flow)
  /** The manifest the browser POSTs to GitHub. GitHub shows one confirmation page and sends back a code. */
  manifest(userId: string) {
    const webhook = this.webhookUrl();
    if (!webhook) {
      throw new ServiceUnavailableException(
        'No public webhook URL yet. Start the stack with `docker compose up` (it creates one) or set WEBHOOK_URL.',
      );
    }
    const web = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const api = this.apiPublicUrl();
    return {
      postUrl: `https://github.com/settings/apps/new?state=${this.state(userId)}`,
      manifest: {
        name: `AI Code Reviewer ${randomBytes(2).toString('hex')}`,
        url: web,
        hook_attributes: { url: webhook, active: true },
        redirect_url: `${api}/api/github/manifest-callback`,
        setup_url: `${api}/api/github/callback`,
        setup_on_update: true,
        public: false,
        default_permissions: {
          metadata: 'read',
          contents: 'read',
          pull_requests: 'write',
          issues: 'write',
          checks: 'write',
        },
        default_events: ['pull_request', 'push'],
      },
    };
  }

  /** Exchanges the temporary code from GitHub for the new app's credentials and stores them. */
  async completeManifest(code: string): Promise<string> {
    const res = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: 'POST',
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'ai-code-reviewer' },
    });
    if (!res.ok) throw new ServiceUnavailableException(`GitHub rejected the setup code (HTTP ${res.status}).`);
    const app = (await res.json()) as { id: number; slug: string; pem: string; webhook_secret: string; html_url: string };
    const values = { appId: app.id, slug: app.slug, privateKey: app.pem, webhookSecret: app.webhook_secret, htmlUrl: app.html_url };
    await this.db.insert(githubApp).values({ id: 'default', ...values }).onConflictDoUpdate({ target: githubApp.id, set: values });
    clearGithubAppCache();
    this.app = null;
    return app.slug;
  }

  // ---- "Connect GitHub": `state` ties the GitHub redirect back to the logged-in user
  private sign(value: string): string {
    return createHmac('sha256', STATE_SECRET).update(`state:${value}`).digest('hex').slice(0, 32);
  }
  state(userId: string): string {
    return `${userId}.${this.sign(userId)}`;
  }
  async installUrl(userId: string): Promise<string> {
    const config = await getGithubAppConfig(this.db);
    if (!config?.slug) throw new ServiceUnavailableException('GitHub App is not set up yet.');
    return `https://github.com/apps/${config.slug}/installations/new?state=${this.state(userId)}`;
  }
  userIdFromState(state: string | undefined): string | null {
    const [userId, sig] = (state ?? '').split('.');
    return userId && sig && sig === this.sign(userId) ? userId : null;
  }

  /** Stores (or updates) an installation and its repo list. `userId` is only known in the callback. */
  async syncInstallation(githubInstallationId: number, userId?: string): Promise<void> {
    const app = await this.getApp();
    const octokit = await app.getInstallationOctokit(githubInstallationId);
    const { data: inst } = await app.octokit.request('GET /app/installations/{installation_id}', {
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
