'use client';

import { useState } from 'react';
import Link from 'next/link';
import Spinner from '@/components/ui/Spinner';
import { AlertCircle, ArrowLeft, CheckCircle2, Mail, Send } from 'lucide-react';

export default function MobileForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    setMessage('');

    if (!email.trim()) {
      setError('Email is required');
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (res.ok) {
        setIsSent(true);
        setMessage(data.message);
      } else {
        setError(data.message || 'Something went wrong.');
      }
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 text-slate-900 flex flex-col">
      <header className="flex items-center justify-center pt-12 pb-8">
        <Link href="/" className="flex items-center gap-3">
          <img src="/logo.svg" alt="OpsKnight" className="h-10 w-10" />
          <span className="text-xl font-bold tracking-tight text-slate-900">OpsKnight</span>
        </Link>
      </header>

      <main className="flex-1 flex flex-col px-6 pb-8">
        <div className="w-full max-w-sm mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
              {isSent ? 'Check your inbox' : 'Reset Password'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isSent
                ? 'If your email exists, you will get reset instructions shortly.'
                : 'Enter your email and we will send a reset link.'}
            </p>
          </div>

          {isSent ? (
            <div className="rounded-2xl border border-emerald-100 bg-white p-5 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="text-sm text-slate-600">{message}</p>
              <Link
                href="/m/login"
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
              >
                <ArrowLeft className="h-4 w-4" />
                Return to Sign In
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5" />
                    <span>{error}</span>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Email Address
                  </label>
                  <div className="relative flex items-center rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-center pl-4 pr-3 py-3.5 border-r border-slate-100">
                      <Mail className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={e => {
                        setEmail(e.target.value);
                        setError('');
                      }}
                      placeholder="name@company.com"
                      autoComplete="email"
                      autoFocus
                      disabled={isSubmitting}
                      className="auth-input w-full bg-transparent px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !email.trim()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <Spinner size="sm" variant="white" />
                      Sending...
                    </>
                  ) : (
                    <>
                      Send Instructions
                      <Send className="h-4 w-4" />
                    </>
                  )}
                </button>

                <div className="text-center">
                  <Link
                    href="/m/login"
                    className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Back to Sign In
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>
      </main>

      <footer className="pb-6 text-center text-[10px] uppercase tracking-[0.18em] text-slate-400">
        Secured by OpsKnight
      </footer>
    </div>
  );
}
