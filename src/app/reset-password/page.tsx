'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, X } from 'lucide-react';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import AuthBrand from '@/components/auth/AuthBrand';
import PasswordStrengthMeter, { isPasswordStrong } from '@/components/auth/PasswordStrengthMeter';
import { useCapabilityToken } from '@/components/auth/useCapabilityToken';
import Spinner from '@/components/ui/Spinner';
import { PASSWORD_TRANSPORT_MAX_CODE_UNITS } from '@/lib/passwords';

function ResetPasswordForm() {
  const { token, ready: tokenReady, clearToken } = useCapabilityToken();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const passwordsMatch = Object.is(password, confirmPassword);

  if (!tokenReady) return <div className="flex justify-center p-8"><Spinner /></div>;
  if (!token && !success) {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm dark:border-red-500/20 dark:bg-red-500/10">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
        <div><p className="font-medium text-red-700 dark:text-red-300">Invalid reset link</p><p className="mt-1 text-xs text-red-600 dark:text-red-300/80">Request a new password reset link and try again.</p></div>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!token) return setError('Invalid or expired reset link.');
    if (!passwordsMatch) return setError('Passwords do not match.');
    if (!isPasswordStrong(password)) return setError('Password does not meet the security requirements.');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) setError(data.error || 'Unable to reset password.');
      else {
        clearToken();
        setPassword('');
        setConfirmPassword('');
        setSuccess(true);
      }
    } catch {
      setError('Unable to reset password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-500/20 dark:bg-emerald-500/10">
          <ShieldCheck className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          <h3 className="mt-3 font-['Space_Grotesk',sans-serif] font-semibold text-emerald-800 dark:text-emerald-300">Password updated</h3>
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-200/80">All previously issued sessions have been revoked.</p>
        </div>
        <Link href="/login?passwordReset=1" className="flex w-full items-center justify-center rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2">Continue to sign in</Link>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div role="alert" aria-live="assertive" className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm dark:border-red-500/20 dark:bg-red-500/10">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" /><p className="flex-1 text-red-700 dark:text-red-300">{error}</p><button type="button" onClick={() => setError('')} aria-label="Dismiss error" className="rounded text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><X className="h-4 w-4" /></button>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">New password</label>
          <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500">
            <Lock className="ml-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input id="password" type={showPassword ? 'text' : 'password'} required value={password} maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS} onChange={e => { setPassword(e.target.value); setError(''); }} autoComplete="new-password" disabled={isSubmitting} className="w-full bg-transparent px-3 py-3 text-sm text-slate-900 outline-none dark:text-white" autoFocus />
            <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="mr-3 rounded p-1 text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:hover:text-slate-300 dark:focus-visible:ring-white">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          </div>
          <PasswordStrengthMeter password={password} />
          <p className="text-[11px] text-slate-400">Additional account-specific password checks are enforced securely on submit.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirm-password" className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Confirm password</label>
          <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500">
            <Lock className="ml-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input id="confirm-password" type={showConfirmPassword ? 'text' : 'password'} required value={confirmPassword} maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS} onChange={e => { setConfirmPassword(e.target.value); setError(''); }} autoComplete="new-password" disabled={isSubmitting} className="w-full bg-transparent px-3 py-3 text-sm text-slate-900 outline-none dark:text-white" />
            <button type="button" onClick={() => setShowConfirmPassword(value => !value)} aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'} className="mr-3 rounded p-1 text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:hover:text-slate-300 dark:focus-visible:ring-white">{showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          </div>
          {confirmPassword && <p className={`flex items-center gap-1 text-xs ${passwordsMatch ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{passwordsMatch ? <CheckCircle2 className="h-3 w-3" /> : <X className="h-3 w-3" />}{passwordsMatch ? 'Passwords match' : 'Passwords do not match'}</p>}
        </div>
        <button type="submit" disabled={isSubmitting || !isPasswordStrong(password) || !passwordsMatch} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2">{isSubmitting ? <><Spinner size="sm" variant="current" /> Updating…</> : <><ShieldCheck className="h-4 w-4" /> Set new password</>}</button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <AuthCard>
        <div className="mb-8 text-center"><AuthBrand className="mb-6" /><h1 className="font-['Space_Grotesk',sans-serif] text-2xl font-bold text-slate-950 dark:text-white">Reset password</h1><p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Secure your account with a new passphrase.</p></div>
        <ResetPasswordForm />
      </AuthCard>
    </AuthLayout>
  );
}
