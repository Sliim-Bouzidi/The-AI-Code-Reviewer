import { SignIn } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) redirect('/dashboard');
  return (
    <AuthShell>
      <SignIn fallbackRedirectUrl='/dashboard' signUpUrl='/sign-up' />
    </AuthShell>
  );
}
