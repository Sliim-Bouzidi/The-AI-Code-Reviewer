import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Loads the monorepo-root `.env` by walking up from the current directory. Safe to call twice. */
export function loadEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const file = join(dir, '.env');
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
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
