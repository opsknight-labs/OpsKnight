'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useState } from 'react';
import { LogOut, ArrowLeft, AlertCircle } from 'lucide-react';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import AuthBrand from '@/components/auth/AuthBrand';
import Spinner from '@/components/ui/Spinner';
import { purgeBrowserAuthCaches } from '@/lib/auth-cache-purge';
import { safeInternalCallbackUrl } from '@/lib/auth-redirect';

export default function SignOutClient() {
  const searchParams = useSearchParams();
  const callbackUrl = safeInternalCallbackUrl(searchParams.get('callbackUrl'), '/login');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState('');

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setError('');
    try {
      try {
        await purgeBrowserAuthCaches();
      } catch {
        // Cache cleanup is defense-in-depth; it must never prevent server logout.
      }
      await signOut({ callbackUrl });
    } catch {
      setError('Sign out could not be completed. Please try again.');
      setIsSigningOut(false);
    }
  };

  return (
    <AuthLayout>
      <AuthCard>
        <div className="mb-8 text-center">
          <AuthBrand className="mb-6" />
          <h1 className="font-['Space_Grotesk',sans-serif] text-2xl font-bold text-slate-950 dark:text-white">Sign out?</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">End your current OpsKnight session.</p>
        </div>
        {error && <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        <div className="space-y-3">
          <button onClick={handleSignOut} disabled={isSigningOut} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2">
            {isSigningOut ? <><Spinner size="sm" variant="current" /> Signing out…</> : <><LogOut className="h-4 w-4" />Sign out</>}
          </button>
          <Link href={callbackUrl} className="group flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2"><ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />Return to app</Link>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
