import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // With Clerk configured, every dashboard page requires a signed-in user.
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    const { userId, redirectToSignIn } = await auth();
    if (!userId) return redirectToSignIn();
  }
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value !== 'false';
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
        <Header />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
