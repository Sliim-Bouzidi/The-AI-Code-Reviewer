import type { Metadata } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import Providers from '@/components/layout/providers';
import ThemeProvider from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { getClerkKeys } from '@/lib/clerk-keys';
import { cn } from '@/lib/utils';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: { default: 'AI Code Reviewer', template: '%s | AI Code Reviewer' },
  description: 'AI code review for GitHub pull requests.',
};

// Clerk keys are read at request time (they can be pasted on the setup page), so no static rendering.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const publishableKey = getClerkKeys()?.publishableKey ?? null;
  return (
    <html lang='en' suppressHydrationWarning data-theme='vercel' className={cn(GeistSans.variable, GeistMono.variable, 'dark')}>
      <body className='bg-background overflow-x-hidden overscroll-none font-sans antialiased' suppressHydrationWarning>
        <ThemeProvider defaultTheme='dark'>
          <Providers publishableKey={publishableKey}>{children}</Providers>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
