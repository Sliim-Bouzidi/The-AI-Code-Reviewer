import { IconCode } from '@tabler/icons-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { InteractiveGridPattern } from '@/components/interactive-grid';
import { cn } from '@/lib/utils';

/** Clean split layout matching next-shadcn-dashboard-starter reference */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className='relative flex min-h-screen flex-col items-center justify-center overflow-hidden md:grid lg:max-w-none lg:grid-cols-2 lg:px-0'>
      <Link
        href='/'
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          'absolute top-4 right-4 z-30 md:top-8 md:right-8 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground'
        )}
      >
        Home
      </Link>
      <div className='relative hidden h-full flex-col p-10 lg:flex dark:border-r border-border'>
        <div className='absolute inset-0 bg-sidebar' />
        <Link href='/' className='text-sidebar-foreground relative z-20 flex items-center gap-2 text-base font-semibold'>
          <span className='flex items-center justify-center w-7 h-7 rounded-lg bg-white text-black'>
            <IconCode className='w-4 h-4' />
          </span>
          <span>AI Code Reviewer</span>
        </Link>
        <InteractiveGridPattern
          className={cn(
            'mask-[radial-gradient(400px_circle_at_center,white,transparent)]',
            'inset-x-0 inset-y-[0%] h-full skew-y-12'
          )}
        />
        <div className='text-sidebar-foreground relative z-20 mt-auto'>
          <blockquote className='space-y-2'>
            <p className='text-lg font-medium'>
              &ldquo;Catch the bug before your reviewer does.&rdquo;
            </p>
            <footer className='text-sidebar-foreground/70 text-sm'>
              Autonomous intelligence for every pull request.
            </footer>
          </blockquote>
        </div>
      </div>
      <div className='flex h-full w-full items-center justify-center p-4 lg:p-8'>
        <div className='flex w-full max-w-md flex-col items-center justify-center space-y-6'>
          <div className='flex items-center gap-2 text-base font-semibold lg:hidden mb-2'>
            <span className='flex items-center justify-center w-7 h-7 rounded-lg bg-white text-black'>
              <IconCode className='w-4 h-4' />
            </span>
            <span>AI Code Reviewer</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
