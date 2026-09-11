'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Mail, User, CheckCircle2, AlertCircle, ShieldCheck, KeyRound, Lock } from 'lucide-react';
import { bootstrapAdmin } from '@/app/setup/actions';
import PasswordStrengthMeter, { isPasswordStrong } from '@/components/auth/PasswordStrengthMeter';
import Spinner from '@/components/ui/Spinner';
import { PASSWORD_TRANSPORT_MAX_CODE_UNITS } from '@/lib/passwords';

type FormState = {
  error?: string | null;
  success?: boolean;
  email?: string | null;
};

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !canSubmit}
      className="w-full rounded-xl bg-slate-950 dark:bg-white py-3 text-sm font-semibold text-white dark:text-slate-950 transition-colors hover:bg-slate-800 dark:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2"
    >
      {pending ? (
        <>
          <Spinner size="sm" variant="current" />
          Creating administrator…
        </>
      ) : (
        <>
          <ShieldCheck className="h-4 w-4" />
          Create administrator
        </>
      )}
    </button>
  );
}

export default function BootstrapSetupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [state, formAction] = useActionState<FormState, FormData>(
    async (_previous, formData) => bootstrapAdmin(formData),
    { error: null, success: false }
  );
  const passwordsMatch = Object.is(password, confirmPassword);
  const passwordContext = useMemo(
    () => ({ email: email.trim().toLowerCase(), displayName: name.trim() }),
    [email, name]
  );

  if (state.success && state.email) {
    return (
      <div className="space-y-5" role="status" aria-live="polite">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-500/20 dark:bg-emerald-500/10">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          <h3 className="mt-3 font-['Space_Grotesk',sans-serif] text-lg font-semibold text-slate-950 dark:text-white">
            Administrator created
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Sign in as {state.email}. The bootstrap capability has been permanently consumed.
          </p>
        </div>
        <a
          href="/login"
          className="block w-full rounded-xl bg-slate-950 py-3 text-center text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2"
        >
          Continue to sign in
        </a>
      </div>
    );
  }

  const canSubmit = isPasswordStrong(password, passwordContext) && passwordsMatch;

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="setup-name" className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Full name
        </label>
        <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500">
          <User className="ml-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input id="setup-name" name="name" type="text" autoComplete="name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} className="w-full bg-transparent px-3 py-3 text-sm text-slate-900 outline-none dark:text-white" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="setup-email" className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Email address
        </label>
        <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500">
          <Mail className="ml-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input id="setup-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} className="w-full bg-transparent px-3 py-3 text-sm text-slate-900 outline-none dark:text-white" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="setup-bootstrap-code" className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Setup authorization code
        </label>
        <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500">
          <KeyRound className="ml-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input id="setup-bootstrap-code" name="bootstrapCode" type="password" autoComplete="off" required maxLength={256} spellCheck={false} className="w-full bg-transparent px-3 py-3 font-mono text-sm text-slate-900 outline-none dark:text-white" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="setup-password" className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Administrator password
        </label>
        <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500">
          <Lock className="ml-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input id="setup-password" name="password" type="password" autoComplete="new-password" required maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS} value={password} onChange={event => setPassword(event.target.value)} className="w-full bg-transparent px-3 py-3 text-sm text-slate-900 outline-none dark:text-white" />
        </div>
        <PasswordStrengthMeter password={password} context={passwordContext} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="setup-confirm-password" className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Confirm password
        </label>
        <input id="setup-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500" />
        {confirmPassword && !passwordsMatch && (
          <p className="text-xs text-red-600 dark:text-red-400">Passwords do not match.</p>
        )}
      </div>

      <SubmitButton canSubmit={canSubmit} />

      {state.error && (
        <div role="alert" aria-live="assertive" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/10">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
        </div>
      )}
    </form>
  );
}
