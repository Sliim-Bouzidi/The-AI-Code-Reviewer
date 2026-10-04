'use client';

import { ClerkProvider, useAuth } from '@clerk/nextjs';
import * as React from 'react';

/**
 * Clerk is optional. With NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set, the dashboard requires sign-in and
 * sends the Clerk session token to the API. Without it, requests carry no token and the API must run
 * with AUTH_DEV_BYPASS=true (local "dev" user).
 */
export const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

type GetToken = () => Promise<string | null>;
const TokenContext = React.createContext<GetToken>(async () => null);
export const useGetToken = () => React.useContext(TokenContext);

function ClerkTokenBridge({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded } = useAuth();
  // Requests made before Clerk has loaded must wait for it: sent without a token they would be
  // answered as the local dev user (AUTH_DEV_BYPASS) and show someone else's data.
  const latest = React.useRef(getToken);
  latest.current = getToken;
  const [ready] = React.useState(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  });
  React.useEffect(() => {
    if (isLoaded) ready.resolve();
  }, [isLoaded, ready]);
  const get = React.useCallback<GetToken>(async () => {
    await ready.promise;
    return latest.current();
  }, [ready]);
  return <TokenContext.Provider value={get}>{children}</TokenContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!CLERK_ENABLED) return <>{children}</>;
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: 'var(--primary)',
          colorPrimaryForeground: 'var(--primary-foreground)',
          colorDanger: 'var(--destructive)',
          colorBackground: 'var(--card)',
          colorForeground: 'var(--foreground)',
          colorMuted: 'var(--muted)',
          colorMutedForeground: 'var(--muted-foreground)',
          colorInput: 'var(--input)',
          colorInputForeground: 'var(--foreground)',
          colorBorder: 'var(--border)',
          colorRing: 'var(--ring)',
          fontFamily: 'var(--font-sans)',
        },
      }}
    >
      <ClerkTokenBridge>{children}</ClerkTokenBridge>
    </ClerkProvider>
  );
}
