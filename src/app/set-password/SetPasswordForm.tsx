'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { AlertCircle, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { setPassword, type SetPasswordState } from './actions';
import PasswordStrengthMeter, { isPasswordStrong } from '@/components/auth/PasswordStrengthMeter';
import Spinner from '@/components/ui/Spinner';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { PASSWORD_TRANSPORT_MAX_CODE_UNITS } from '@/lib/passwords';
import { cn } from '@/lib/utils';
import { purgeBrowserAuthCaches } from '@/lib/auth-cache-purge';

const passwordFieldClass =
  'h-11 min-h-11 2xl:h-12 pl-10 pr-10 rounded-xl bg-card text-sm shadow-xs hover:border-ring/50 transition-colors';

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !canSubmit}
      aria-busy={pending || undefined}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {pending ? (
        <>
          <Spinner size="sm" variant="current" /> Activating…
        </>
      ) : (
        <>
          <ShieldCheck className="h-4 w-4" /> Set password and activate
        </>
      )}
    </button>
  );
}

export default function SetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPasswordValue] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [state, formAction] = useActionState<SetPasswordState, FormData>(setPassword, {
    error: null,
    success: false,
  });
  const passwordsMatch = Object.is(password, confirmPassword);
  const canSubmit = isPasswordStrong(password) && passwordsMatch;
  const mismatch = !!confirmPassword && !passwordsMatch;

  const handleProceedToLogin = useCallback(async () => {
    try {
      await purgeBrowserAuthCaches();
    } catch {
      // Defense-in-depth: cache cleanup must never prevent signout
    }
    try {
      // Without an explicit callbackUrl NextAuth posts window.location.href (a
      // full URL carrying the reset token), which WAF RFI rules block.
      await signOut({ redirect: false, callbackUrl: '/login?password=1' });
    } catch {
      // Defense-in-depth: if signOut fails, proceed with client redirect
    }
    router.push('/login?password=1');
  }, [router]);

  useEffect(() => {
    if (state.success) {
      void handleProceedToLogin();
    }
  }, [state.success, handleProceedToLogin]);

  if (state.success) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <div className="rounded-xl border border-status-ok/30 bg-status-ok-soft p-5 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-status-ok" />
          <h3 className="mt-3 font-display font-semibold text-status-ok-deep">Account activated</h3>
          <p className="mt-1 text-sm text-status-ok-deep">
            Your password has been set. Redirecting to sign in…
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleProceedToLogin()}
          className="flex w-full items-center justify-center rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Continue to sign in
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-sm"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p id="invite-form-error" className="text-destructive">
            {state.error}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="invite-password" className="text-xs text-foreground">
          New password
        </Label>
        <div className="group relative flex items-center">
          <div className="absolute left-3.5 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
            <Lock className="h-4 w-4" aria-hidden="true" />
          </div>
          <Input
            id="invite-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS}
            onChange={event => setPasswordValue(event.target.value)}
            autoComplete="new-password"
            placeholder="Enter your password"
            aria-invalid={state.error ? true : undefined}
            aria-describedby={cn('invite-password-help', state.error && 'invite-form-error')}
            className={cn(passwordFieldClass, state.error && 'border-destructive')}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPassword(value => !value)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            aria-controls="invite-password"
            className="absolute right-2.5 z-10 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <PasswordStrengthMeter password={password} />
        <p id="invite-password-help" className="text-xs text-muted-foreground">
          Account-specific password checks are enforced on activation.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="invite-confirm-password" className="text-xs text-foreground">
          Confirm password
        </Label>
        <div className="group relative flex items-center">
          <div className="absolute left-3.5 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
            <Lock className="h-4 w-4" aria-hidden="true" />
          </div>
          <Input
            id="invite-confirm-password"
            name="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            required
            value={confirmPassword}
            maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS}
            onChange={event => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Re-enter your password"
            aria-invalid={mismatch || state.error ? true : undefined}
            aria-describedby={
              cn(mismatch && 'invite-confirm-error', state.error && 'invite-form-error') ||
              undefined
            }
            className={cn(passwordFieldClass, (mismatch || state.error) && 'border-destructive')}
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(value => !value)}
            aria-label={
              showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'
            }
            aria-pressed={showConfirmPassword}
            aria-controls="invite-confirm-password"
            className="absolute right-2.5 z-10 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showConfirmPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {mismatch && (
          <p id="invite-confirm-error" className="text-xs text-destructive">
            Passwords do not match.
          </p>
        )}
      </div>

      <SubmitButton canSubmit={canSubmit} />
    </form>
  );
}
