import type { Metadata } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import Providers from '@/components/layout/providers';
import ThemeProvider from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: { default: 'AI Code Reviewer', template: '%s | AI Code Reviewer' },
  description: 'AI code review for GitHub pull requests.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning data-theme='vercel' className={cn(GeistSans.variable, GeistMono.variable, 'dark')}>
      <body className='bg-background overflow-x-hidden overscroll-none font-sans antialiased' suppressHydrationWarning>
        <ThemeProvider defaultTheme='dark'>
          <Providers>{children}</Providers>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
