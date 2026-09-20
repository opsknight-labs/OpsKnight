'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Mail,
  User,
  CheckCircle2,
  AlertCircle,
  Lock,
  Eye,
  EyeOff,
  X,
  Globe,
  KeyRound,
} from 'lucide-react';
import { bootstrapAdmin } from '@/app/setup/actions';
import PasswordStrengthMeter, { isPasswordStrong } from '@/components/auth/PasswordStrengthMeter';
import Spinner from '@/components/ui/Spinner';
import { PASSWORD_TRANSPORT_MAX_CODE_UNITS } from '@/lib/passwords';
import { cn } from '@/lib/utils';
import { purgeBrowserAuthCaches } from '@/lib/auth-cache-purge';

type FormState = {
  error?: string | null;
  success?: boolean;
  email?: string | null;
};

type Props = {
  initialAppUrl?: string;
  requiresSecret?: boolean;
};

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !canSubmit}
      className={cn(
        'group relative w-full h-11 2xl:h-12 px-4 rounded-lg font-semibold text-sm 2xl:text-base text-white transition-all duration-150 flex items-center justify-center gap-2 mt-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.995]',
        'bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 border border-slate-900 dark:border-white shadow-sm shadow-slate-950/15 hover:shadow'
      )}
    >
      {pending ? (
        <>
          <Spinner size="sm" variant="white" />
          <span>Creating administrator…</span>
        </>
      ) : (
        <>
          <span>Create administrator</span>
          <svg
            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            />
          </svg>
        </>
      )}
    </button>
  );
}

export default function BootstrapSetupForm({ initialAppUrl = '', requiresSecret = false }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [appUrl, setAppUrl] = useState(initialAppUrl);
  const [setupSecret, setSetupSecret] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);

  const [state, formAction] = useActionState<FormState, FormData>(
    async (_previous, formData) => bootstrapAdmin(formData),
    { error: null, success: false }
  );

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const passwordsMatch = Boolean(
    password && confirmPassword && Object.is(password, confirmPassword)
  );
  const passwordContext = useMemo(
    () => ({ email: email.trim().toLowerCase(), displayName: name.trim() }),
    [email, name]
  );

  if (state.success && state.email) {
    purgeBrowserAuthCaches();
    return (
      <div className="text-center py-4 space-y-4" role="status" aria-live="polite">
        <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            Administrator created
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your system is initialized. Sign in as{' '}
            <span className="font-medium text-slate-900 dark:text-white">{state.email}</span>.
          </p>
        </div>
        <a
          href="/login"
          className="inline-flex items-center justify-center w-full h-11 2xl:h-12 rounded-lg font-semibold text-sm bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 transition-colors"
        >
          Continue to sign in
        </a>
      </div>
    );
  }

  const canSubmit =
    Boolean(name.trim()) &&
    isEmailValid &&
    (!requiresSecret || Boolean(setupSecret.trim())) &&
    isPasswordStrong(password, passwordContext) &&
    passwordsMatch;

  return (
    <form action={formAction} className="space-y-4">
      {state.error && dismissedError !== state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-xs animate-shake"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1 leading-relaxed">{state.error}</span>
          <button
            type="button"
            onClick={() => setDismissedError(state.error ?? null)}
            className="text-red-400 hover:text-red-600 dark:hover:text-red-300 p-0.5"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Name */}
      <div>
        <label
          htmlFor="setup-name"
          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Full name
        </label>
        <div className="group relative flex items-center">
          <div className="absolute left-4 z-10 text-slate-400 dark:text-slate-500 group-focus-within:text-slate-800 dark:group-focus-within:text-slate-200 transition-colors pointer-events-none">
            <User className="h-4 w-4" />
          </div>
          <input
            id="setup-name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            required
            maxLength={100}
            value={name}
            onChange={event => {
              setName(event.target.value);
              setDismissedError(null);
            }}
            className="auth-input w-full h-11 2xl:h-12 pl-12 pr-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-base sm:text-sm 2xl:text-base shadow-xs hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100 focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-white/15 transition-all"
          />
        </div>
      </div>

      {/* Email */}
      <div>
        <label
          htmlFor="setup-email"
          className={cn(
            'block text-xs font-medium mb-1.5 transition-colors',
            emailTouched && email && !isEmailValid
              ? 'text-red-600 dark:text-red-400'
              : 'text-slate-700 dark:text-slate-300'
          )}
        >
          Email address
        </label>
        <div className="group relative flex items-center">
          <div className="absolute left-4 z-10 text-slate-400 dark:text-slate-500 group-focus-within:text-slate-800 dark:group-focus-within:text-slate-200 transition-colors pointer-events-none">
            <Mail className="h-4 w-4" />
          </div>
          <input
            id="setup-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            maxLength={254}
            value={email}
            onChange={event => {
              setEmail(event.target.value);
              setDismissedError(null);
            }}
            onBlur={() => setEmailTouched(true)}
            className="auth-input w-full h-11 2xl:h-12 pl-12 pr-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-base sm:text-sm 2xl:text-base shadow-xs hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100 focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-white/15 transition-all"
          />
          {emailTouched && email && !isEmailValid && (
            <div className="absolute right-3 z-10 text-red-500">
              <AlertCircle className="w-4 h-4" />
            </div>
          )}
        </div>
        {emailTouched && email && !isEmailValid && (
          <p className="text-[10px] text-red-500 dark:text-red-400 font-medium pl-1 mt-1">
            Please enter a valid email address
          </p>
        )}
      </div>

      {/* Application URL */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label
            htmlFor="setup-app-url"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            Application URL
          </label>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">Base URL</span>
        </div>
        <div className="group relative flex items-center">
          <div className="absolute left-4 z-10 text-slate-400 dark:text-slate-500 group-focus-within:text-slate-800 dark:group-focus-within:text-slate-200 transition-colors pointer-events-none">
            <Globe className="h-4 w-4" />
          </div>
          <input
            id="setup-app-url"
            name="appUrl"
            type="url"
            required
            maxLength={256}
            value={appUrl}
            onChange={event => setAppUrl(event.target.value)}
            placeholder="http://localhost:3000"
            className="auth-input w-full h-11 2xl:h-12 pl-12 pr-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-base sm:text-sm 2xl:text-base shadow-xs hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100 focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-white/15 transition-all"
          />
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          Canonical URL used for redirects, invite links, and webhook callbacks.
        </p>
      </div>

      {/* Setup Secret (only shown when required by server environment) */}
      {requiresSecret && (
        <div>
          <label
            htmlFor="setup-secret"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Setup secret
          </label>
          <div className="group relative flex items-center">
            <div className="absolute left-4 z-10 text-slate-400 dark:text-slate-500 group-focus-within:text-slate-800 dark:group-focus-within:text-slate-200 transition-colors pointer-events-none">
              <KeyRound className="h-4 w-4" />
            </div>
            <input
              id="setup-secret"
              name="setupSecret"
              type="password"
              autoComplete="off"
              placeholder="Enter environment setup secret"
              required
              maxLength={256}
              value={setupSecret}
              onChange={event => {
                setSetupSecret(event.target.value);
                setDismissedError(null);
              }}
              className="auth-input w-full h-11 2xl:h-12 pl-12 pr-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-base sm:text-sm 2xl:text-base shadow-xs hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100 focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-white/15 transition-all"
            />
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Required by the server environment configuration (SETUP_SECRET).
          </p>
        </div>
      )}

      {/* Password */}
      <div>
        <label
          htmlFor="setup-password"
          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Administrator password
        </label>
        <div className="group relative flex items-center">
          <div className="absolute left-4 z-10 text-slate-400 dark:text-slate-500 group-focus-within:text-slate-800 dark:group-focus-within:text-slate-200 transition-colors pointer-events-none">
            <Lock className="h-4 w-4" />
          </div>
          <input
            id="setup-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Enter your password"
            required
            maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS}
            value={password}
            onChange={event => {
              setPassword(event.target.value);
              setDismissedError(null);
            }}
            className="auth-input w-full h-11 2xl:h-12 pl-12 pr-11 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-base sm:text-sm 2xl:text-base shadow-xs hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100 focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-white/15 transition-all"
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3 z-10 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div className="mt-2">
          <PasswordStrengthMeter password={password} context={passwordContext} />
        </div>
      </div>

      {/* Confirm Password */}
      <div>
        <label
          htmlFor="setup-confirm-password"
          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Confirm password
        </label>
        <div className="group relative flex items-center">
          <div className="absolute left-4 z-10 text-slate-400 dark:text-slate-500 group-focus-within:text-slate-800 dark:group-focus-within:text-slate-200 transition-colors pointer-events-none">
            <Lock className="h-4 w-4" />
          </div>
          <input
            id="setup-confirm-password"
            name="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Confirm your password"
            required
            maxLength={PASSWORD_TRANSPORT_MAX_CODE_UNITS}
            value={confirmPassword}
            onChange={event => {
              setConfirmPassword(event.target.value);
              setDismissedError(null);
            }}
            className="auth-input w-full h-11 2xl:h-12 pl-12 pr-11 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-base sm:text-sm 2xl:text-base shadow-xs hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100 focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-white/15 transition-all"
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(v => !v)}
            aria-label={
              showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'
            }
            className="absolute right-3 z-10 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {confirmPassword && (
          <p
            className={`flex items-center gap-1.5 text-xs pt-1.5 ${
              passwordsMatch
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {passwordsMatch ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Passwords match</span>
              </>
            ) : (
              <>
                <X className="h-3.5 w-3.5" />
                <span>Passwords do not match</span>
              </>
            )}
          </p>
        )}
      </div>

      <div className="pt-2">
        <SubmitButton canSubmit={canSubmit} />
      </div>
    </form>
  );
}
