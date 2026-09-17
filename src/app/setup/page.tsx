import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Image from 'next/image';
import BootstrapSetupForm from '@/components/BootstrapSetupForm';
import { logger } from '@/lib/logger';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import { ShieldAlert } from 'lucide-react';

export const dynamic = 'force-dynamic';

const isNextRedirectError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
};

export default async function SetupPage() {
  const requestId = (await headers()).get('x-request-id') || 'unavailable';

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
      <AuthLayout>
        <AuthCard>
          <div className="text-center mb-7">
            <div className="flex items-center justify-center gap-2.5 mb-3.5">
              <Image
                src="/logo.png"
                alt="OpsKnight"
                width={32}
                height={32}
                className="h-8 w-8 2xl:h-10 2xl:w-10 object-contain"
                priority
                unoptimized
              />
              <span className="text-[clamp(1.25rem,4.5vw,1.5rem)] 2xl:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
                OpsKnight
              </span>
            </div>
            <div className="mx-auto my-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h2 className="text-[clamp(1.55rem,6vw,1.875rem)] 2xl:text-4xl font-bold text-slate-950 dark:text-white mb-2 tracking-tight min-h-[1.25em] flex items-center justify-center">
              Setup unavailable
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-normal transition-colors duration-300">
              OpsKnight could not initialize the setup service. Check database connectivity and the
              server logs using the reference below.
            </p>
            <p className="mt-4 font-mono text-xs text-slate-400">Reference: {requestId}</p>
          </div>
        </AuthCard>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthCard>
        {/* Brand Header */}
        <div className="text-center mb-7">
          <div className="flex items-center justify-center gap-2.5 mb-3.5">
            <Image
              src="/logo.png"
              alt="OpsKnight"
              width={32}
              height={32}
              className="h-8 w-8 2xl:h-10 2xl:w-10 object-contain"
              priority
              unoptimized
            />
            <span className="text-[clamp(1.25rem,4.5vw,1.5rem)] 2xl:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
              OpsKnight
            </span>
          </div>
          <h2 className="text-[clamp(1.55rem,6vw,1.875rem)] 2xl:text-4xl font-bold text-slate-950 dark:text-white mb-2 tracking-tight min-h-[1.25em] flex items-center justify-center">
            Welcome to OpsKnight
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-normal transition-colors duration-300">
            Create your administrator account to get started.
          </p>
        </div>

        <BootstrapSetupForm />
      </AuthCard>
    </AuthLayout>
  );
}
