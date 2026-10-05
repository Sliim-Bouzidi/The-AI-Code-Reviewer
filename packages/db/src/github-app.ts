import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { githubApp } from './schema.js';

export interface GithubAppConfig {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
}

let cached: { value: GithubAppConfig | null; at: number } | null = null;
const TTL_MS = 10_000;

/** Forget the cached config (called right after the setup flow saves a new app). */
export function clearGithubAppCache(): void {
  cached = null;
}

/**
 * The GitHub App credentials: the row saved by the dashboard's "Create GitHub App" flow, or the
 * GITHUB_APP_* env vars as a fallback. Returns null when neither exists (app not set up yet).
 */
export async function getGithubAppConfig(db: Db): Promise<GithubAppConfig | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const [row] = await db.select().from(githubApp).where(eq(githubApp.id, 'default'));
  let value: GithubAppConfig | null = null;
  if (row) {
    value = { appId: String(row.appId), slug: row.slug, privateKey: row.privateKey, webhookSecret: row.webhookSecret };
  } else if (process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_WEBHOOK_SECRET) {
    value = {
      appId: process.env.GITHUB_APP_ID,
      slug: process.env.GITHUB_APP_SLUG ?? '',
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    };
  }
  cached = { value, at: Date.now() };
  return value;
}

export async function requireGithubAppConfig(db: Db): Promise<GithubAppConfig> {
  const config = await getGithubAppConfig(db);
  if (!config) throw new Error('GitHub App is not set up yet. Open the dashboard and click "Create GitHub App".');
  return config;
}
