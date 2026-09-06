'use client';

import { useState } from 'react';
import { setPassword } from './actions';
import PasswordStrengthMeter from '@/components/auth/PasswordStrengthMeter';

type Props = {
  token: string;
  userEmail: string;
  error?: string;
};

function errorMessage(code?: string) {
  if (!code) return '';
  if (code === 'missing') return 'Invite token missing.';
  if (code === 'weak') return 'Password must be at least 10 characters.';
  if (code === 'complexity') return 'Password must include upper, lower, and numeric characters.';
  if (code === 'mismatch') return 'Passwords do not match.';
  if (code === 'expired') return 'This invite link has expired.';
  if (code === 'invalid') return 'Invalid invite link.';
  return 'Unable to set password.';
}

export default function SetPasswordForm({ token, userEmail, error }: Props) {
  const [password, setPasswordState] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="relative w-full max-w-[460px] overflow-hidden rounded-2xl border border-white/10 bg-white/95 text-slate-900 shadow-2xl shadow-slate-900/30">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900" />
      <div className="relative space-y-5 px-6 py-7 sm:px-8 sm:py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Account activation
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">Set Your Password</h2>
            <p className="mt-2 text-sm text-slate-500">
              Create a password for <strong className="text-slate-700">{userEmail}</strong>
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white shadow-lg shadow-slate-900/20">
            <img src="/logo.svg" alt="OpsKnight" className="h-6 w-6" />
          </div>
        </div>

        <form
          action={formData => {
            setIsSubmitting(true);
            setPassword(formData);
          }}
          className="space-y-4"
        >
          <input type="hidden" name="token" value={token} />

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              New password
            </label>
            <input
              name="password"
              type="password"
              required
              minLength={10}
              placeholder="At least 10 characters"
              value={password}
              onChange={e => setPasswordState(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 shadow-inner shadow-slate-200 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
            />
            {password && (
              <div className="mt-2">
                <PasswordStrengthMeter password={password} minLength={10} />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              Confirm password
            </label>
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={10}
              placeholder="Repeat password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 shadow-inner shadow-slate-200 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
            />
          </div>

          {error && (
            <div
              className="flex items-start gap-3 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
              role="alert"
              aria-live="polite"
            >
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{errorMessage(error)}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 hover:-translate-y-[1px] hover:bg-slate-800 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition group-hover:animate-[shimmer_1.4s_ease_infinite]" />
            <span>{isSubmitting ? 'Setting Password...' : 'Set Password'}</span>
            {!isSubmitting && (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.3}
                  d="M5 12h14M12 5l7 7-7 7"
                />
              </svg>
            )}
          </button>
        </form>

        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
          <span>Secure by default</span>
          <span>Your data, your cloud</span>
        </div>
      </div>
    </div>
  );
}
