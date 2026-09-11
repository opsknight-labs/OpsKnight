'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { setPassword, type SetPasswordState } from './actions';
import PasswordStrengthMeter, { isPasswordStrong } from '@/components/auth/PasswordStrengthMeter';
import Spinner from '@/components/ui/Spinner';
import { PASSWORD_TRANSPORT_MAX_CODE_UNITS } from '@/lib/passwords';

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !canSubmit}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2"
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
  const [password, setPasswordValue] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [state, formAction] = useActionState<SetPasswordState, FormData>(setPassword, {
    error: null,
  });
  const passwordsMatch = Object.is(password, confirmPassword);
  const canSubmit = isPasswordStrong(password) && passwordsMatch;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm dark:border-red-500/20 dark:bg-red-500/10"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-red-700 dark:text-red-300">{state.error}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="invite-password" className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          New password
        </label>
        <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500">
          <Lock className="ml-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input
            id="invite-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS}
            onChange={event => setPasswordValue(event.target.value)}
            autoComplete="new-password"
            className="w-full bg-transparent px-3 py-3 text-sm text-slate-900 outline-none dark:text-white"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPassword(value => !value)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="mr-3 rounded p-1 text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:hover:text-slate-300 dark:focus-visible:ring-white"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <PasswordStrengthMeter password={password} />
        <p className="text-[11px] text-slate-400">Account-specific password checks are enforced on activation.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="invite-confirm-password" className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Confirm password
        </label>
        <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500">
          <Lock className="ml-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input
            id="invite-confirm-password"
            name="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            required
            value={confirmPassword}
            maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS}
            onChange={event => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            className="w-full bg-transparent px-3 py-3 text-sm text-slate-900 outline-none dark:text-white"
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(value => !value)}
            aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
            className="mr-3 rounded p-1 text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:hover:text-slate-300 dark:focus-visible:ring-white"
          >
            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {confirmPassword && !passwordsMatch && (
          <p className="text-xs text-red-600 dark:text-red-400">Passwords do not match.</p>
        )}
      </div>

      <SubmitButton canSubmit={canSubmit} />
    </form>
  );
}
