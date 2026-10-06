import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';
import { getClerkKeys } from '@/lib/clerk-keys';

// Makes the Clerk session available to server code. The sign-in check itself is in app/dashboard/layout.tsx.
// Keys are resolved on every request (env or the first-run setup file), so pasting them needs no rebuild.
const withClerk = clerkMiddleware(
  async () => {},
  () => {
    const keys = getClerkKeys();
    return { publishableKey: keys?.publishableKey, secretKey: keys?.secretKey };
  },
);

// Without Clerk keys there is no session to read; the dashboard layout then redirects to /sign-in,
// which shows the first-run form to paste the keys (sign-in is mandatory).
export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (!getClerkKeys()) return NextResponse.next();
  return withClerk(req, event);
}

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)'],
};
