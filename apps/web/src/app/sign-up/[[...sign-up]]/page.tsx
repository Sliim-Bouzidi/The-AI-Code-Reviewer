import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';

export const metadata: Metadata = { title: 'Create account' };

export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) redirect('/dashboard');
  return (
    <AuthShell>
      <SignUp fallbackRedirectUrl='/dashboard' signInUrl='/sign-in' />
    </AuthShell>
  );
}
