import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadEnv, requireEnv } from '@codereview/shared';

loadEnv();
const client = postgres(requireEnv('DATABASE_URL'), { max: 1 });
await client`CREATE EXTENSION IF NOT EXISTS vector`;
await migrate(drizzle(client), {
  migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
});
await client.end();
console.log('Migrations applied.');
