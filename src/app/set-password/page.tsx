'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import SetPasswordForm from './SetPasswordForm';
import { AuthCard, AuthLayout } from '@/components/auth/AuthLayout';
import AuthBrand from '@/components/auth/AuthBrand';
import Spinner from '@/components/ui/Spinner';

function readCapabilityToken(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const fragmentToken = new URLSearchParams(hash).get('token');
  if (fragmentToken) return fragmentToken;
  return new URLSearchParams(window.location.search).get('token');
}

function InviteActivation() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    // Capture the capability exactly once before scrubbing it. Next patches
    // history.replaceState to synchronize router state, so re-running this
    // effect after the scrub would erase the in-memory invitation token.
    const rawToken = readCapabilityToken();
    setToken(rawToken);
    setTokenReady(true);
    if (rawToken) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  if (!tokenReady) {
    return <div className="flex justify-center p-8"><Spinner /></div>;
  }

  if (!token) {
    return (
      <div className="space-y-5">
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-500/20 dark:bg-amber-500/10">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200">Missing invitation</p>
            <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/80">Open the complete invitation link from your administrator or email.</p>
          </div>
        </div>
        <Link href="/login" className="flex w-full items-center justify-center rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2">
          Back to sign in
        </Link>
      </div>
    );
  }

  return <SetPasswordForm token={token} />;
}

export default function SetPasswordPage() {
  return (
    <AuthLayout>
      <AuthCard>
        <div className="mb-8 text-center">
          <AuthBrand className="mb-6" />
          <h1 className="font-['Space_Grotesk',sans-serif] text-2xl font-bold text-slate-950 dark:text-white">Complete your invitation</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Set a secure passphrase to activate your OpsKnight account.</p>
        </div>
        <InviteActivation />
      </AuthCard>
    </AuthLayout>
  );
}
