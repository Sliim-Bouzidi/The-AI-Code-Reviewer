import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { OnboardingGate } from '@/components/onboarding-gate';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Every dashboard page requires a signed-in user. Without Clerk keys nobody can sign in, so send
  // people to /sign-in, which explains how to configure it.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) redirect('/sign-in');
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value !== 'false';
  // signed in, but GitHub not connected yet -> /onboarding (OnboardingGate)
  return (
    <OnboardingGate>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar />
        <SidebarInset>
          <Header />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </OnboardingGate>
  );
}
