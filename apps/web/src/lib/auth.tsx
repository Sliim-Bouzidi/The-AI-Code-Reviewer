'use client';

import { ClerkProvider, useAuth } from '@clerk/nextjs';
import * as React from 'react';

type GetToken = () => Promise<string | null>;
const TokenContext = React.createContext<GetToken>(async () => null);
export const useGetToken = () => React.useContext(TokenContext);

function ClerkTokenBridge({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded } = useAuth();
  // Requests made before Clerk has loaded must wait for it, or they would go out without a token
  // and fail with 401.
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

/**
 * Clerk sign-in is mandatory. The publishable key comes from the server at request time (env or the
 * first-run setup page), not from the build. Without it only the public pages render (no session),
 * and the dashboard redirects to /sign-in, which asks for the keys.
 */
export function AuthProvider({ children, publishableKey }: { children: React.ReactNode; publishableKey: string | null }) {
  if (!publishableKey) return <>{children}</>;
  return (
    <ClerkProvider
      publishableKey={publishableKey}
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
