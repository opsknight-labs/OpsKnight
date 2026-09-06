'use client';

import { useState } from 'react';
import Link from 'next/link';
import Spinner from '@/components/ui/Spinner';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import { Mail, ArrowLeft, Send, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ForgotPasswordPage() {
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
    } catch (_err) {
      setError('An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <AuthCard isSuccess={isSent}>
        {/* Card Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-extrabold tracking-tight text-white tracking-tight flex items-center gap-3">
            {isSent ? (
              <span className="text-emerald-400 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <CheckCircle2 className="w-6 h-6" />
                Request Received
              </span>
            ) : (
              <span className="flex items-center gap-3">
                <span className="w-1.5 h-6 bg-white/20 rounded-full" />
                Account Recovery
              </span>
            )}
          </h2>
          <p className="mt-2 text-sm text-white/50 pl-0.5">
            {!isSent &&
              "Enter your email address and we'll send you instructions to reset your password."}
          </p>
        </div>

        {isSent ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center text-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <p className="text-sm text-emerald-200/80 leading-relaxed max-w-xs">{message}</p>
            </div>

            <Link
              href="/login"
              className="relative w-full overflow-hidden rounded-lg py-3.5 text-sm font-bold shadow-lg transition-all duration-300 bg-white text-black hover:bg-white/95 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-cyan-400/50 flex items-center justify-center gap-2 uppercase tracking-wide"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Return to Sign In</span>
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-6 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-200 text-sm flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="h-5 w-5 shrink-0 text-rose-500 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-rose-400 mb-1">Request Failed</p>
                  <p className="text-white/70">{error}</p>
                </div>
                <button
                  onClick={() => setError('')}
                  className="text-white/40 hover:text-white transition"
                  aria-label="Dismiss error"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="group space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-white/60 transition-colors duration-300 group-focus-within:text-white/80">
                  Email Address
                </label>
                <div className="relative group/input">
                  <div className="absolute inset-0 bg-white/5 rounded-xl transition duration-300 group-hover/input:bg-white/10" />
                  <div className="absolute inset-[1px] bg-[#0a0a0a] rounded-[11px]" />

                  <div className="relative flex items-center pr-3 group-focus-within:border-white/30 group-focus-within:bg-white/5 rounded-xl border border-white/10 transition-colors duration-300">
                    <div className="flex items-center justify-center pl-4 pr-3 py-3.5 border-r border-white/10">
                      <Mail className="h-5 w-5 text-white/40 transition-colors group-focus-within/input:text-white/70" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={e => {
                        setEmail(e.target.value);
                        if (error) setError('');
                      }}
                      className="w-full bg-transparent px-4 py-3 text-white placeholder:text-white/20 focus:outline-none transition-colors"
                      placeholder="name@company.com"
                      autoComplete="email"
                      required
                      disabled={isSubmitting}
                      autoFocus
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <button
                  type="submit"
                  disabled={isSubmitting || !email}
                  className="relative w-full overflow-hidden rounded-lg py-3.5 text-sm font-bold shadow-lg transition-all duration-300 bg-white text-black hover:bg-white/95 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-cyan-400/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2 uppercase tracking-wide">
                    {isSubmitting ? (
                      <>
                        <Spinner size="sm" variant="black" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <span>Send Instructions</span>
                        <Send className="h-4 w-4" />
                      </>
                    )}
                  </span>
                </button>

                <div className="text-center">
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-2 text-xs font-semibold text-white/40 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Back to Sign In
                  </Link>
                </div>
              </div>
            </form>
          </>
        )}

        {/* Footer info */}
        <div className="flex flex-col items-center justify-center gap-3 mt-8">
          <p className="text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium text-center">
            If you don't receive an email or SMS, please contact your administrator.
          </p>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-white/40 font-medium">
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
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
