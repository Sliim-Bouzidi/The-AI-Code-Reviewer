import 'reflect-metadata';
import { loadEnv } from '@codereview/shared';

loadEnv(); // before AppModule is imported, so providers see the env

const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('./app.module.js');

// rawBody keeps the exact bytes GitHub signed, for webhook signature verification
const app = await NestFactory.create<import('@nestjs/platform-express').NestExpressApplication>(AppModule, {
  rawBody: true,
});
app.useBodyParser('json', { limit: '2mb' }); // diffs sent by the MCP server
// WEB_URL is the dashboard; CORS_ORIGINS adds more (comma-separated), e.g. Vercel preview domains
const origins = [process.env.WEB_URL ?? 'http://localhost:3000', ...(process.env.CORS_ORIGINS?.split(',') ?? [])]
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);
app.enableCors({ origin: origins, credentials: true });

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000); // PORT is set by Railway
await app.listen(port);
console.log(`Core API listening on http://localhost:${port}`);
{
  // sign-in is mandatory: without Clerk only MCP API keys work and the dashboard cannot log anyone in
  const { getClerkKeys } = await import('./auth/clerk-keys.js');
  if (!getClerkKeys()) console.error('NOTE: Clerk is not configured yet. Open the dashboard and paste the Clerk keys on the sign-in page.');
}
