import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import BootstrapSetupForm from '@/components/BootstrapSetupForm';
import { logger } from '@/lib/logger';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import { ShieldAlert } from 'lucide-react';
import { getAuthoritativeRequestOrigin } from '@/lib/request-host';

export const dynamic = 'force-dynamic';

const isNextRedirectError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
};

export default async function SetupPage() {
  const headerStore = await headers();
  const requestId = headerStore.get('x-request-id') || 'unavailable';

  try {
    if ((await prisma.user.count()) > 0) redirect('/login');
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    logger.error('[Setup Page] Database/setup initialization error', {
      component: 'setup-page',
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    return (
      <AuthLayout showAnimation={false}>
        <AuthCard>
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h1 className="mt-4 font-['Space_Grotesk',sans-serif] text-2xl font-bold text-slate-950 dark:text-white">
              Setup unavailable
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              OpsKnight could not initialize the setup service. Check database connectivity and the
              server logs using the reference below.
            </p>
            <p className="mt-4 font-mono text-xs text-slate-400">Reference: {requestId}</p>
          </div>
        </AuthCard>
      </AuthLayout>
    );
  }

  const detectedAppUrl =
    getAuthoritativeRequestOrigin(headerStore) ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'http://localhost:3000';

  return (
    <AuthLayout showAnimation={false}>
      <AuthCard>
        <div className="mb-7 text-center">
          <h1 className="font-['Space_Grotesk',sans-serif] text-2xl font-bold text-slate-950 dark:text-white">
            System initialization
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            Create the first administrator account to get started with your incident control
            surface.
          </p>
        </div>

        <BootstrapSetupForm initialAppUrl={detectedAppUrl} />
      </AuthCard>
    </AuthLayout>
  );
}
