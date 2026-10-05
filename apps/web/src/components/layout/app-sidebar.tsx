'use client';

import { useUser, useClerk } from '@clerk/nextjs';
import {
  IconChartBar,
  IconChevronRight,
  IconCode,
  IconGitPullRequest,
  IconKey,
  IconLayoutDashboard,
  IconLogout,
  IconSettings,
  IconSparkles,
  IconUser,
} from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from '@/components/ui/sidebar';

const NAV = [
  { title: 'Overview', url: '/dashboard', icon: IconLayoutDashboard, exact: true },
  { title: 'Repositories', url: '/dashboard/repos', icon: IconGitPullRequest, also: '/dashboard/reviews' },
  { title: 'Quality', url: '/dashboard/quality', icon: IconChartBar },
  { title: 'AI providers', url: '/dashboard/providers', icon: IconSparkles },
  { title: 'API keys & MCP', url: '/dashboard/keys', icon: IconKey },
];

/* ─── Vercel-style User Dropdown ─── */
function UserDropdown() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const name = user?.fullName ?? user?.username ?? 'Account';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const imageUrl = user?.imageUrl;
  const initials = name
    .split(' ')
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className='relative'>
      {/* Trigger — user avatar + name row */}
      <button
        onClick={() => setOpen(!open)}
        className='w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-muted/50 transition-colors text-left group-data-[collapsible=icon]:hidden'
      >
        {imageUrl ? (
          <img src={imageUrl} alt={name} width={32} height={32} className='rounded-full size-8 shrink-0' />
        ) : (
          <span className='flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-semibold'>
            {initials}
          </span>
        )}
        <div className='grid min-w-0 flex-1 text-sm leading-tight group-data-[collapsible=icon]:hidden'>
          <span className='truncate font-medium'>{name}</span>
          <span className='text-muted-foreground truncate text-xs'>{email}</span>
        </div>
      </button>

      {/* Dropdown popover */}
      {open && (
        <div className='absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border bg-popover shadow-xl z-50 py-1 min-w-[220px] group-data-[collapsible=icon]:left-auto group-data-[collapsible=icon]:right-auto group-data-[collapsible=icon]:min-w-[240px]'>
          {/* User header */}
          <div className='flex items-center gap-2.5 px-3 py-2.5'>
            {imageUrl ? (
              <img src={imageUrl} alt={name} width={32} height={32} className='rounded-full size-8 shrink-0' />
            ) : (
              <span className='flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-semibold'>
                {initials}
              </span>
            )}
            <div className='grid min-w-0 flex-1 text-sm leading-tight'>
              <span className='truncate font-medium'>{name}</span>
              <span className='text-muted-foreground truncate text-xs'>{email}</span>
            </div>
            <IconChevronRight className='size-4 text-muted-foreground' />
          </div>

          <div className='h-px bg-border mx-2 my-1' />

          {/* Menu items */}
          <button
            onClick={() => { setOpen(false); }}
            className='w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left'
          >
            <IconUser className='size-4 text-muted-foreground' />
            <span>Profile</span>
          </button>
          <button
            onClick={() => { setOpen(false); }}
            className='w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left'
          >
            <IconSettings className='size-4 text-muted-foreground' />
            <span>Settings</span>
          </button>

          <div className='h-px bg-border mx-2 my-1' />

          <button
            onClick={() => signOut({ redirectUrl: '/' })}
            className='w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left text-red-400'
          >
            <IconLogout className='size-4' />
            <span>Log out</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader className='group-data-[collapsible=icon]:pt-4'>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size='lg' render={<Link href='/dashboard' aria-label='AI Code Reviewer' />}>
              <div className='bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg'>
                <IconCode className='size-4' />
              </div>
              <div className='grid flex-1 text-left text-sm leading-tight'>
                <span className='truncate font-semibold'>AI Code Reviewer</span>
                <span className='text-muted-foreground truncate text-xs'>Pull request reviews</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className='overflow-x-hidden'>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {NAV.map((item) => {
              const active = item.exact
                ? pathname === item.url
                : pathname.startsWith(item.url) || (item.also ? pathname.startsWith(item.also) : false);
              return (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    render={<Link href={item.url} aria-label={item.title} />}
                    tooltip={item.title}
                    isActive={active}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserDropdown />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
