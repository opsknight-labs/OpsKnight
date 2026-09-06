import prisma from '@/lib/prisma';
import Link from 'next/link';
import { createHash } from 'crypto';
import SetPasswordForm from './SetPasswordForm';

type SearchParams = {
  token?: string;
  error?: string;
};

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-slate-950 text-white">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(148,163,184,0.18),transparent_32%),radial-gradient(circle_at_78%_18%,rgba(100,116,139,0.16),transparent_30%),radial-gradient(circle_at_42%_78%,rgba(71,85,105,0.14),transparent_32%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] opacity-15" />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-950/92 to-slate-950" />

      <div className="relative mx-auto flex min-h-[100dvh] max-w-7xl flex-col items-center justify-center px-5 py-6">
        {/* Header */}
        <header className="absolute top-6 left-5 right-5 flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-white/5 px-4 py-2.5 backdrop-blur-sm max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 shadow-lg shadow-black/20">
              <img src="/logo.svg" alt="OpsKnight logo" className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100/90">
                OpsKnight
              </p>
              <p className="text-sm text-slate-200/80">Account Setup</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-100">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,0.8)] animate-pulse" />
            Secure setup
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const awaitedSearchParams = await searchParams;
  const token = typeof awaitedSearchParams?.token === 'string' ? awaitedSearchParams.token : '';
  const error =
    typeof awaitedSearchParams?.error === 'string' ? awaitedSearchParams.error : undefined;

  // 1. Invalid Token Check (Missing)
  if (!token) {
    return (
      <PageShell>
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-slate-200 backdrop-blur-md">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white">Missing Invite Link</h2>
          <p className="mt-2 text-sm text-slate-400">
            This URL is missing the invite token. Please click the link in your email again.
          </p>
          <div className="mt-6">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Back to Login
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const record = await prisma.userToken.findFirst({
    where: { tokenHash, type: 'INVITE', usedAt: null },
  });

  // 2. Invalid Token Check (Not Found)
  if (!record) {
    return (
      <PageShell>
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-slate-200 backdrop-blur-md">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20 text-red-500">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white">Invalid Invite Link</h2>
          <p className="mt-2 text-sm text-slate-400">
            This invitation link is invalid. Please ask your administrator for a new invite.
          </p>
          <div className="mt-6">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Back to Login
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  // 3. Expired Token Check
  if (record.expiresAt < new Date()) {
    return (
      <PageShell>
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-slate-200 backdrop-blur-md">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white">Invite Link Expired</h2>
          <p className="mt-2 text-sm text-slate-400">
            This invitation link is no longer valid. Please ask your administrator for a new invite.
          </p>
          <div className="mt-6">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Back to Login
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  // 4. Valid Token - Render Form
  return (
    <PageShell>
      <SetPasswordForm token={token} userEmail={record.identifier} error={error} />
    </PageShell>
  );
}
