import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Loads environment files (.env, .env.local, apps/worker/.env.local) with proper override precedence. Safe to call twice. */
export function loadEnv(): void {
  // 1. Walk up to load base .env files first
  const envFilesToLoad: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const file = join(dir, '.env');
    if (existsSync(file)) envFilesToLoad.push(file);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const f of envFilesToLoad.reverse()) {
    try {
      process.loadEnvFile(f);
    } catch {}
  }

  // 2. Load .env.local files in hierarchical order
  const localFiles: string[] = [];
  dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const localFile = join(dir, '.env.local');
    if (existsSync(localFile)) localFiles.push(localFile);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const f of localFiles.reverse()) {
    try {
      process.loadEnvFile(f);
    } catch {}
  }

  // 3. apps/worker/.env.local specific override (loads non-empty values over empty placeholders)
  const workerLocal = join(process.cwd(), 'apps', 'worker', '.env.local');
  if (existsSync(workerLocal)) {
    try {
      process.loadEnvFile(workerLocal);
    } catch {}
    try {
      const content = readFileSync(workerLocal, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          let v = trimmed.slice(eqIdx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (v && (!process.env[k] || process.env[k].trim() === '')) {
            process.env[k] = v;
          }
        }
      }
    } catch {}
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** ioredis connection options for BullMQ, from REDIS_URL. */
export function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}
