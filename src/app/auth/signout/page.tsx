import { Suspense } from 'react';
import SignOutClient from './signout-client';

/** Minimal skeleton that matches the new right-panel card layout while the
 *  client bundle hydrates. No old glass-panel / login-shell dead code. */
function SignOutSkeleton() {
  return (
    <div className="relative min-h-[100dvh] w-full bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-[360px] sm:max-w-[400px] animate-pulse space-y-6 py-8">
        <div className="h-7 w-32 rounded-lg bg-slate-200 dark:bg-slate-800" />
        <div className="h-4 w-64 rounded bg-slate-100 dark:bg-slate-800/60" />
        <div className="space-y-3 pt-2">
          <div className="h-11 w-full rounded-xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-11 w-full rounded-xl bg-slate-100 dark:bg-slate-800/60" />
        </div>
      </div>
    </div>
  );
}

export default function SignOutPage() {
  return (
    <Suspense fallback={<SignOutSkeleton />}>
      <SignOutClient />
    </Suspense>
  );
}
