import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';

// Makes the Clerk session available to server code. The sign-in check itself is in app/dashboard/layout.tsx.
const withClerk = clerkMiddleware();

// Without Clerk keys there is no session to read; the dashboard layout then redirects to /sign-in,
// which shows the setup instructions (sign-in is mandatory).
export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return NextResponse.next();
  return withClerk(req, event);
}

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)'],
};
