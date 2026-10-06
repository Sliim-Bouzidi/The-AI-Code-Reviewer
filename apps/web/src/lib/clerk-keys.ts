import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Server-only: the Clerk keys, read at request time (not baked into the build), so keys pasted on
 * the first-run setup page work immediately. Sources, in order:
 *  1. env (`CLERK_PUBLISHABLE_KEY` or `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, plus `CLERK_SECRET_KEY`)
 *  2. `<CONFIG_DIR>/clerk.json`, written by the API's setup endpoint (shared Docker volume)
 * The same rules as apps/api/src/auth/clerk-keys.ts.
 */
export interface ClerkKeys {
  publishableKey: string;
  secretKey: string;
}

// cwd is apps/web (pnpm and Docker both start Next from there)
const FILE = join(process.env.CONFIG_DIR ?? resolve(process.cwd(), '..', '..', '.runtime'), 'clerk.json');
let cache: { mtime: number; keys: ClerkKeys | null } | null = null;

// bracket access with a computed name: Next.js would otherwise inline NEXT_PUBLIC_* at build time
const env = (name: string) => process.env[name];

export function getClerkKeys(): ClerkKeys | null {
  const envPk = env('CLERK_PUBLISHABLE_KEY') || env(['NEXT', 'PUBLIC', 'CLERK', 'PUBLISHABLE', 'KEY'].join('_'));
  const envSk = env('CLERK_SECRET_KEY');
  if (envPk && envSk) return { publishableKey: envPk, secretKey: envSk };
  try {
    const mtime = statSync(FILE).mtimeMs;
    if (cache?.mtime === mtime) return cache.keys;
    const data = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<ClerkKeys>;
    const keys = data.publishableKey && data.secretKey ? { publishableKey: data.publishableKey, secretKey: data.secretKey } : null;
    cache = { mtime, keys };
    return keys;
  } catch {
    return null;
  }
}
