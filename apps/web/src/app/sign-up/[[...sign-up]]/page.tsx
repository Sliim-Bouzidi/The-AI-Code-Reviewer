import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { ClerkSetupRequired } from '@/components/clerk-setup-required';
import { getClerkKeys } from '@/lib/clerk-keys';

export const metadata: Metadata = { title: 'Create account' };

export default function SignUpPage() {
  // sign-in is mandatory: without Clerk keys, explain the setup instead of opening the dashboard
  if (!getClerkKeys()) {
    return (
      <AuthShell>
        <ClerkSetupRequired />
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <SignUp fallbackRedirectUrl='/dashboard' signInUrl='/sign-in' />
    </AuthShell>
  );
}
