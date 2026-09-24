'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail, ArrowLeft, Send, CheckCircle2, AlertCircle, X } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import AuthBrand from '@/components/auth/AuthBrand';
import { fetchWithTimeout } from '@/lib/client-timeout';
import { appRoutes } from '@/lib/app-routes';

const GENERIC_MESSAGE =
  'If an account exists with this email, you will receive password reset instructions.';

export default function ForgotPasswordPage() {
  const pathname = usePathname();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState('');
  const loginHref = appRoutes.login(pathname?.startsWith('/m') ? 'mobile' : 'desktop');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetchWithTimeout(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ email }),
        },
        12_000
      );
      if (!response.ok) throw new Error('request_failed');
      setIsSent(true);
    } catch {
      setError('Unable to submit the recovery request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout isSuccess={isSent}>
      <AuthCard>
        <div className="mb-8 text-center">
          <AuthBrand className="mb-6" />
          <h1 className="font-['Space_Grotesk',sans-serif] text-2xl font-bold text-slate-950 dark:text-white">
            {isSent ? 'Check your inbox' : 'Account recovery'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            {isSent
              ? 'If the account exists, recovery instructions will arrive shortly.'
              : 'Enter your email to request a password reset link.'}
          </p>
        </div>
        {isSent ? (
          <div className="space-y-4" role="status" aria-live="polite">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-500/20 dark:bg-emerald-500/10">
              <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-200/80">
                {GENERIC_MESSAGE}
              </p>
            </div>
            <Link
              href={loginHref}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="mb-5 flex items-start gap-3 rounded-lg border border-red-200/80 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/20 p-3 text-xs shadow-xs transition-all"
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 mt-0.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                </div>
                <p className="flex-1 text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={() => setError('')}
                  aria-label="Dismiss error"
                  className="shrink-0 p-0.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400"
                >
                  Email address
                </label>
                <div className="group relative flex items-center">
                  <div className="absolute left-3.5 z-10 text-slate-400 dark:text-slate-500 group-focus-within:text-slate-800 dark:group-focus-within:text-slate-200 transition-colors pointer-events-none">
                    <Mail className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => {
                      setEmail(e.target.value);
                      setError('');
                    }}
                    maxLength={254}
                    autoComplete="email"
                    required
                    disabled={isSubmitting}
                    placeholder="you@company.com"
                    className="auth-input w-full h-11 min-h-[44px] 2xl:h-12 pl-10 pr-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm shadow-xs hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100 focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-white/15 transition-all"
                    autoFocus
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isSubmitting || !email}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2"
              >
                {isSubmitting ? (
                  <>
                    <Spinner size="sm" variant="current" /> Sending…
                  </>
                ) : (
                  <>
                    Send reset link <Send className="h-4 w-4" />
                  </>
                )}
              </button>
              <div className="text-center">
                <Link
                  href={loginHref}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to sign in
                </Link>
              </div>
            </form>
          </>
        )}
      </AuthCard>
    </AuthLayout>
  );
}
