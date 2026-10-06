import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Clerk keys, from `.env` or pasted on the dashboard's first-run setup page.
 * Pasted keys are written to `<CONFIG_DIR>/clerk.json`, a file shared with the web container
 * (Docker volume), so sign-in starts working without editing `.env` or rebuilding.
 * `.env` wins when both exist.
 */
export interface ClerkKeys {
  publishableKey: string;
  secretKey: string;
  source: 'env' | 'dashboard';
}

/** Shared config folder: /config in Docker, `<repo>/.runtime` with `pnpm dev` (cwd is apps/api). */
export const CONFIG_DIR = process.env.CONFIG_DIR ?? resolve(process.cwd(), '..', '..', '.runtime');
const FILE = join(CONFIG_DIR, 'clerk.json');

let cache: { mtime: number; keys: ClerkKeys | null } | null = null;

export function getClerkKeys(): ClerkKeys | null {
  const envPk = process.env.CLERK_PUBLISHABLE_KEY || process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'];
  const envSk = process.env.CLERK_SECRET_KEY;
  if (envPk && envSk) return { publishableKey: envPk, secretKey: envSk, source: 'env' };
  try {
    const mtime = statSync(FILE).mtimeMs;
    if (cache?.mtime === mtime) return cache.keys;
    const data = JSON.parse(readFileSync(FILE, 'utf8')) as { publishableKey?: string; secretKey?: string };
    const keys = data.publishableKey && data.secretKey ? { publishableKey: data.publishableKey, secretKey: data.secretKey, source: 'dashboard' as const } : null;
    cache = { mtime, keys };
    return keys;
  } catch {
    return null; // no file yet
  }
}

/** Atomically writes the keys (readable by the owner only where the OS supports it). */
export function saveClerkKeys(publishableKey: string, secretKey: string): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ publishableKey, secretKey, savedAt: new Date().toISOString() }, null, 2));
  try {
    chmodSync(tmp, 0o644); // the web container runs as another user and must read it; the volume is not exposed
  } catch {
    // Windows: no POSIX modes
  }
  renameSync(tmp, FILE);
  cache = null;
}

/** The Frontend API host encoded in a publishable key (pk_test_<base64("host$")>), or null if malformed. */
export function frontendApiOf(publishableKey: string): string | null {
  const m = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[2]!, 'base64').toString('utf8');
    return decoded.endsWith('$') && decoded.length > 2 ? decoded.slice(0, -1) : null;
  } catch {
    return null;
  }
}
