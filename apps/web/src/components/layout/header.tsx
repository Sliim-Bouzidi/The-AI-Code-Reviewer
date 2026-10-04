'use client';

import { IconMoon, IconSun } from '@tabler/icons-react';
import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

export default function Header() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <header className='bg-background/60 sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 backdrop-blur-md'>
      <div className='flex items-center gap-2 px-4'>
        <SidebarTrigger className='-ml-1' />
        <Separator orientation='vertical' className='mr-2 h-4 data-vertical:self-center' />
        <span className='text-muted-foreground text-sm'>Dashboard</span>
      </div>
      <div className='px-4'>
        <Button
          variant='secondary'
          size='icon'
          aria-label='Toggle light or dark theme'
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          <IconSun className='dark:hidden' />
          <IconMoon className='hidden dark:block' />
        </Button>
      </div>
    </header>
  );
}
