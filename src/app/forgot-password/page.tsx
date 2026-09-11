'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowLeft, Send, CheckCircle2, AlertCircle, X } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import AuthBrand from '@/components/auth/AuthBrand';

const GENERIC_MESSAGE =
  'If an account exists with this email, you will receive password reset instructions.';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ email }),
      });
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
          <h1 className="font-['Space_Grotesk',sans-serif] text-2xl font-bold text-slate-950 dark:text-white">{isSent ? 'Check your inbox' : 'Account recovery'}</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{isSent ? 'If the account exists, recovery instructions will arrive shortly.' : 'Enter your email to request a password reset link.'}</p>
        </div>
        {isSent ? (
          <div className="space-y-4" role="status" aria-live="polite">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-500/20 dark:bg-emerald-500/10">
              <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-200/80">{GENERIC_MESSAGE}</p>
            </div>
            <Link href="/login" className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2"><ArrowLeft className="h-4 w-4" />Back to sign in</Link>
          </div>
        ) : (
          <>
            {error && (
              <div role="alert" aria-live="assertive" className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm dark:border-red-500/20 dark:bg-red-500/10">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <p className="flex-1 text-red-700 dark:text-red-300">{error}</p>
                <button type="button" onClick={() => setError('')} aria-label="Dismiss error" className="rounded text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><X className="h-4 w-4" /></button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Email address</label>
                <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500">
                  <Mail className="ml-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <input id="email" type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} maxLength={254} autoComplete="email" required disabled={isSubmitting} autoFocus className="w-full bg-transparent px-3 py-3 text-sm text-slate-900 outline-none dark:text-white" />
                </div>
              </div>
              <button type="submit" disabled={isSubmitting || !email} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2">
                {isSubmitting ? <><Spinner size="sm" variant="current" /> Sending…</> : <>Send reset link <Send className="h-4 w-4" /></>}
              </button>
              <div className="text-center"><Link href="/login" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"><ArrowLeft className="h-3 w-3" />Back to sign in</Link></div>
            </form>
          </>
        )}
      </AuthCard>
    </AuthLayout>
  );
}
