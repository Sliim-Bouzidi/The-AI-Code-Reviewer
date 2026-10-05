import { IconLock } from '@tabler/icons-react';

/**
 * Shown instead of the sign-in form when the Clerk keys are missing. Sign-in is mandatory, so the
 * dashboard stays closed until the person running this install configures Clerk.
 */
export function ClerkSetupRequired() {
  return (
    <div className='flex w-full max-w-md flex-col gap-4 rounded-xl border p-6'>
      <div className='flex items-center gap-2'>
        <IconLock className='size-5' />
        <h1 className='text-lg font-semibold'>Sign-in isn&apos;t configured yet</h1>
      </div>
      <p className='text-muted-foreground text-sm'>
        This install has no Clerk keys, so nobody can sign in and the dashboard stays locked. Whoever runs the server sets
        this up once:
      </p>
      <ol className='text-sm [&>li]:mt-2 list-decimal pl-5'>
        <li>
          Create a free application at{' '}
          <a className='underline underline-offset-4' href='https://dashboard.clerk.com' target='_blank' rel='noreferrer'>
            dashboard.clerk.com
          </a>{' '}
          and enable GitHub as a sign-in method.
        </li>
        <li>
          Copy its two keys into <code className='font-mono'>.env</code>:
          <pre className='bg-muted mt-2 overflow-x-auto rounded-lg p-3 font-mono text-xs'>
            {'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...\nCLERK_SECRET_KEY=sk_test_...'}
          </pre>
        </li>
        <li>
          Rebuild: <code className='font-mono'>docker compose up -d --build</code>
        </li>
      </ol>
    </div>
  );
}
