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
app.enableCors({ origin: process.env.WEB_URL ?? 'http://localhost:3000', credentials: true });

const port = Number(process.env.API_PORT ?? 4000);
await app.listen(port);
console.log(`Core API listening on http://localhost:${port}`);
if (!process.env.CLERK_SECRET_KEY) {
  // sign-in is mandatory: without Clerk only MCP API keys work and the dashboard cannot log anyone in
  console.error('WARNING: CLERK_SECRET_KEY is not set. Dashboard sign-in is disabled until the Clerk keys are in .env.');
}
