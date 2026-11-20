'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, X } from 'lucide-react';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import AuthBrand from '@/components/auth/AuthBrand';
import PasswordStrengthMeter, { isPasswordStrong } from '@/components/auth/PasswordStrengthMeter';
import { useCapabilityToken } from '@/components/auth/useCapabilityToken';
import Spinner from '@/components/ui/Spinner';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { PASSWORD_TRANSPORT_MAX_CODE_UNITS } from '@/lib/passwords';
import { cn } from '@/lib/utils';

const passwordFieldClass =
  'h-11 min-h-11 2xl:h-12 pl-10 pr-10 rounded-xl bg-card text-sm shadow-xs hover:border-ring/50 transition-colors';

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

  if (!tokenReady)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  if (!token && !success) {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium text-destructive">Invalid reset link</p>
          <p className="mt-1 text-xs text-destructive">
            Request a new password reset link and try again.
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!token) return setError('Invalid or expired reset link.');
    if (!passwordsMatch) return setError('Passwords do not match.');
    if (!isPasswordStrong(password))
      return setError('Password does not meet the security requirements.');
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
        <div className="rounded-xl border border-status-ok/30 bg-status-ok-soft p-5 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-status-ok" />
          <h3 className="mt-3 font-display font-semibold text-status-ok-deep">Password updated</h3>
          <p className="mt-1 text-sm text-status-ok-deep">
            All previously issued sessions have been revoked.
          </p>
        </div>
        <Link
          href="/login?passwordReset=1"
          className="flex w-full items-center justify-center rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Continue to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p id="form-error" className="flex-1 text-destructive">
            {error}
          </p>
          <button
            type="button"
            data-icon-button
            onClick={() => setError('')}
            aria-label="Dismiss error"
            title="Dismiss"
            className="relative shrink-0 flex h-6 w-6 min-h-0 min-w-0 p-0 after:absolute after:-inset-2.5 after:content-[''] items-center justify-center rounded-full bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5 stroke-[2.25]" />
          </button>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-xs text-foreground">
            New password
          </Label>
          <div className="group relative flex items-center">
            <div className="absolute left-3.5 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </div>
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS}
              onChange={e => {
                setPassword(e.target.value);
                setError('');
              }}
              autoComplete="new-password"
              disabled={isSubmitting}
              placeholder="Enter new password"
              aria-invalid={error ? true : undefined}
              aria-describedby={cn('password-help', error && 'form-error')}
              className={cn(passwordFieldClass, error && 'border-destructive')}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(value => !value)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              aria-controls="password"
              className="absolute right-2.5 z-10 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <PasswordStrengthMeter password={password} />
          <p id="password-help" className="text-xs text-muted-foreground">
            Additional account-specific password checks are enforced securely on submit.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password" className="text-xs text-foreground">
            Confirm password
          </Label>
          <div className="group relative flex items-center">
            <div className="absolute left-3.5 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </div>
            <Input
              id="confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              required
              value={confirmPassword}
              maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS}
              onChange={e => {
                setConfirmPassword(e.target.value);
                setError('');
              }}
              autoComplete="new-password"
              disabled={isSubmitting}
              placeholder="Confirm new password"
              aria-invalid={(confirmPassword && !passwordsMatch) || error ? true : undefined}
              aria-describedby={
                cn(confirmPassword && 'confirm-password-match', error && 'form-error') || undefined
              }
              className={cn(
                passwordFieldClass,
                ((confirmPassword && !passwordsMatch) || error) && 'border-destructive'
              )}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(value => !value)}
              aria-label={
                showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'
              }
              aria-pressed={showConfirmPassword}
              aria-controls="confirm-password"
              className="absolute right-2.5 z-10 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {confirmPassword && (
            <p
              id="confirm-password-match"
              className={`flex items-center gap-1 text-xs ${passwordsMatch ? 'text-status-ok' : 'text-destructive'}`}
            >
              {passwordsMatch ? (
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              ) : (
                <X className="h-3 w-3" aria-hidden="true" />
              )}
              {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={isSubmitting || !isPasswordStrong(password) || !passwordsMatch}
          aria-busy={isSubmitting || undefined}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {isSubmitting ? (
            <>
              <Spinner size="sm" variant="current" /> Updating…
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4" /> Set new password
            </>
          )}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <AuthCard>
        <div className="mb-8 text-center">
          <AuthBrand className="mb-6" />
          <h1 className="font-display text-2xl font-bold text-foreground">Reset password</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Secure your account with a new passphrase.
          </p>
        </div>
        <ResetPasswordForm />
      </AuthCard>
    </AuthLayout>
  );
}
