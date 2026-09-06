import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import BootstrapSetupForm from '@/components/BootstrapSetupForm';
import { logger } from '@/lib/logger';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';

export const dynamic = 'force-dynamic';

const isNextRedirectError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
};

export default async function SetupPage() {
  try {
    const totalUsers = await prisma.user.count();
    if (totalUsers > 0) {
      redirect('/login');
    }
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    logger.error('[Setup Page] Database error', { component: 'setup-page', error });

    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
      errorMessage.includes('connect') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('P1001')
    ) {
      return (
        <div className="relative min-h-[100dvh] overflow-hidden bg-slate-950 text-white">
          {/* Background Effects */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(239,68,68,0.2),transparent_32%),radial-gradient(circle_at_78%_18%,rgba(100,116,139,0.16),transparent_30%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] opacity-15" />
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-950/92 to-slate-950" />

          <div className="relative mx-auto flex min-h-[100dvh] max-w-7xl flex-col items-center justify-center px-5 py-6">
            <div className="relative w-full max-w-[520px] overflow-hidden rounded-2xl border border-white/10 bg-white/95 text-slate-900 shadow-2xl">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-600 via-red-500 to-red-600" />
              <div className="relative space-y-5 px-6 py-7 sm:px-8 sm:py-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-500">
                      Connection Error
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold text-slate-900">
                      Database Unavailable
                    </h1>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-red-600">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                </div>

                <p className="text-sm text-slate-500">
                  Unable to connect to the database. Please ensure:
                </p>

                <ul className="space-y-2 text-sm text-slate-600">
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                    The database server is running
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                    The DATABASE_URL environment variable is correctly configured
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                    <span>
                      If using Docker Compose, run:{' '}
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                        docker-compose up -d OpsKnight-db
                      </code>
                    </span>
                  </li>
                </ul>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">Error Details</p>
                  <p className="mt-1 font-mono text-xs text-slate-600 break-all">{errorMessage}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    throw error;
  }

  return (
    <AuthLayout showAnimation={false}>
      <AuthCard>
        {/* Card Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-extrabold tracking-tight text-white tracking-tight flex items-center gap-3">
            <span className="flex items-center gap-3">
              <span className="w-1.5 h-6 bg-white/20 rounded-full" />
              System Initialization
            </span>
          </h2>
          <p className="mt-2 text-sm text-white/50 pl-0.5">
            Create the first admin account to get started with your incident control surface.
          </p>
        </div>

        {/* Warning */}
        <div className="mb-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm flex items-start gap-3">
          <svg
            className="h-5 w-5 shrink-0 text-amber-500 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div className="flex-1">
            <p className="font-semibold text-amber-400 mb-1">Important Security Notice</p>
            <p className="text-white/70">
              Please change this password immediately after your first login to secure your account.
            </p>
          </div>
        </div>

        <BootstrapSetupForm />
      </AuthCard>
    </AuthLayout>
  );
}
