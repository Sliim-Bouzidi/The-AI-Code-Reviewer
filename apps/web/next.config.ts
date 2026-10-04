import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// One .env for the whole monorepo: load the root file before Next reads NEXT_PUBLIC_* values.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ['geist'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
  },
  async redirects() {
    return [
      // the API's GitHub install callback lands on /repos
      { source: '/repos', destination: '/dashboard/repos', permanent: false },
    ];
  },
};

export default nextConfig;
