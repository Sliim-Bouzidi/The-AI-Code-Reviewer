import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Connect GitHub' };

/** Onboarding requires a signed-in user, like the dashboard (sign-in is mandatory). */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) redirect('/sign-in');
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  return children;
}
