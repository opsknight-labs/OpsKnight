'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useState } from 'react';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import { LogOut, ArrowLeft } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { purgeBrowserAuthCaches } from '@/lib/auth-cache-purge';

export default function SignOutClient() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/login';
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await purgeBrowserAuthCaches();
    await signOut({ callbackUrl });
  };

  return (
    <AuthLayout>
      <AuthCard>
        {/* Card Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-extrabold tracking-tight text-white tracking-tight flex items-center gap-3">
            <span className="flex items-center gap-3">
              <span className="w-1.5 h-6 bg-white/20 rounded-full" />
              Sign Out
            </span>
          </h2>
          <p className="mt-2 text-sm text-white/50 pl-0.5">
            Are you sure you want to end your secure session?
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="relative w-full overflow-hidden rounded-lg py-3.5 text-sm font-bold shadow-lg transition-all duration-300 bg-rose-500 text-white hover:bg-rose-400 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(244,63,94,0.4)] focus:outline-none focus:ring-2 focus:ring-rose-500/50 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg"
          >
            <span className="relative z-10 flex items-center justify-center gap-2 uppercase tracking-wide">
              {isSigningOut ? (
                <>
                  <Spinner size="sm" variant="white" />
                  <span>Signing out...</span>
                </>
              ) : (
                <>
                  <span>Termimate Session</span>
                  <LogOut className="h-4 w-4" />
                </>
              )}
            </span>
          </button>

          <Link
            href={callbackUrl}
            className="group relative w-full flex items-center justify-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-white/5 py-3.5 text-sm font-bold text-white/70 transition-all duration-300 hover:bg-white/10 hover:text-white hover:border-white/20"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            <span>Return to App</span>
          </Link>
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.15em] text-white/40 mt-8 font-medium">
          <svg
            className="h-3.5 w-3.5 text-emerald-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <span>Your Operations, Our Sentinel.</span>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
