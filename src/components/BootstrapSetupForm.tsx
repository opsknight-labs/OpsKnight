'use client';

import { useActionState, useMemo, useState, useSyncExternalStore } from 'react';
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
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
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

const setupFieldClass =
  'h-11 min-h-11 2xl:h-12 pl-12 rounded-xl bg-card text-base sm:text-sm 2xl:text-base shadow-xs hover:border-ring/50 transition-colors';
const toggleClass =
  'absolute right-3 z-10 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !canSubmit}
      aria-busy={pending || undefined}
      className={cn(
        'group relative w-full h-11 2xl:h-12 px-4 rounded-lg font-semibold text-sm 2xl:text-base transition-all duration-150 flex items-center justify-center gap-2 mt-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.995]',
        'bg-primary hover:bg-primary/90 text-primary-foreground border border-primary shadow-sm hover:shadow'
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
  const currentOrigin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => ''
  );

  const [state, formAction] = useActionState<FormState, FormData>(
    async (_previous, formData) => bootstrapAdmin(formData),
    { error: null, success: false }
  );

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const emailInvalid = emailTouched && !!email && !isEmailValid;
  const normalizedAppOrigin = (() => {
    try {
      const candidate = new URL(appUrl);
      if (
        !['http:', 'https:'].includes(candidate.protocol) ||
        candidate.username ||
        candidate.password ||
        candidate.pathname !== '/' ||
        candidate.search ||
        candidate.hash
      )
        return '';
      return candidate.origin;
    } catch {
      return '';
    }
  })();
  const appUrlMatchesBrowser = Boolean(currentOrigin && normalizedAppOrigin === currentOrigin);
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
        <div className="w-12 h-12 rounded-full bg-status-ok/15 text-status-ok flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-foreground">Administrator created</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Your system is initialized. Sign in as{' '}
            <span className="font-medium text-foreground">{state.email}</span>.
          </p>
        </div>
        <a
          href="/login"
          className="inline-flex items-center justify-center w-full h-11 2xl:h-12 rounded-lg font-semibold text-sm bg-primary hover:bg-primary/90 text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Continue to sign in
        </a>
      </div>
    );
  }

  const canSubmit =
    Boolean(name.trim()) &&
    isEmailValid &&
    Boolean(normalizedAppOrigin) &&
    (!requiresSecret || Boolean(setupSecret.trim())) &&
    isPasswordStrong(password, passwordContext) &&
    passwordsMatch;

  return (
    <form action={formAction} className="space-y-4">
      {state.error && dismissedError !== state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2.5 p-3.5 rounded-lg bg-destructive/5 border border-destructive/30 text-destructive text-xs animate-shake"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1 leading-relaxed">{state.error}</span>
          <button
            type="button"
            onClick={() => setDismissedError(state.error ?? null)}
            className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Dismiss error"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5 stroke-[2.25]" />
          </button>
        </div>
      )}

      {/* Name */}
      <div>
        <Label htmlFor="setup-name" className="mb-1.5 block text-xs text-foreground">
          Full name
        </Label>
        <div className="group relative flex items-center">
          <div className="absolute left-4 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
            <User className="h-4 w-4" aria-hidden="true" />
          </div>
          <Input
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
            className={cn(setupFieldClass, 'pr-4')}
          />
        </div>
      </div>

      {/* Email */}
      <div>
        <Label
          htmlFor="setup-email"
          className={cn(
            'mb-1.5 block text-xs transition-colors',
            emailInvalid ? 'text-destructive' : 'text-foreground'
          )}
        >
          Email address
        </Label>
        <div className="group relative flex items-center">
          <div className="absolute left-4 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
            <Mail className="h-4 w-4" aria-hidden="true" />
          </div>
          <Input
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
            aria-invalid={emailInvalid || undefined}
            aria-describedby={emailInvalid ? 'setup-email-error' : undefined}
            className={cn(setupFieldClass, 'pr-4', emailInvalid && 'border-destructive')}
          />
          {emailInvalid && (
            <div className="absolute right-3 z-10 text-destructive" aria-hidden="true">
              <AlertCircle className="w-4 h-4" />
            </div>
          )}
        </div>
        {emailInvalid && (
          <p id="setup-email-error" className="text-xs text-destructive font-medium mt-1">
            Please enter a valid email address
          </p>
        )}
      </div>

      {/* Application URL */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <Label htmlFor="setup-app-url" className="mb-1.5 block text-xs text-foreground">
            Application URL
          </Label>
          <span className="text-2xs text-muted-foreground">Detected from request</span>
        </div>
        <div className="group relative flex items-center">
          <div className="absolute left-4 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
            <Globe className="h-4 w-4" aria-hidden="true" />
          </div>
          <Input
            id="setup-app-url"
            name="appUrl"
            type="url"
            required
            maxLength={256}
            value={appUrl}
            onChange={event => setAppUrl(event.target.value)}
            placeholder="http://localhost:3000"
            aria-describedby="setup-app-url-help"
            className={cn(setupFieldClass, 'pr-4')}
          />
        </div>
        <div id="setup-app-url-help" className="mt-1.5 space-y-1 text-xs leading-relaxed">
          <p className="text-muted-foreground">
            Canonical public address used for application links, callbacks, and host authorization.
            Keep it aligned with your authentication URL in normal deployments.
          </p>
          {appUrlMatchesBrowser ? (
            <p className="text-status-ok">✓ Matches the address currently open in your browser.</p>
          ) : (
            <p className="text-status-elevated-deep">
              ⚠ This differs from the address currently open in your browser.
            </p>
          )}
          <p className="text-status-elevated-deep">
            <span className="font-semibold">Important:</span> Enter the exact address (domain or IP)
            you will use. For security, accessing OpsKnight from any unlisted address will be
            blocked with a &quot;Misdirected Request&quot; error.
          </p>
        </div>
      </div>

      {/* One-time bootstrap capability, with environment secret compatibility. */}
      {requiresSecret && (
        <div>
          <Label htmlFor="setup-secret" className="mb-1.5 block text-xs text-foreground">
            Bootstrap code
          </Label>
          <div className="group relative flex items-center">
            <div className="absolute left-4 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </div>
            <Input
              id="setup-secret"
              name="setupSecret"
              type="password"
              autoComplete="off"
              placeholder="Enter the one-time bootstrap code"
              required
              maxLength={256}
              value={setupSecret}
              onChange={event => {
                setSetupSecret(event.target.value);
                setDismissedError(null);
              }}
              aria-describedby="setup-secret-help"
              className={cn(setupFieldClass, 'pr-4')}
            />
          </div>
          <p id="setup-secret-help" className="text-xs text-muted-foreground mt-1">
            Generate a 30-minute, one-time code with `node scripts/create-bootstrap-code.mjs`. A
            configured SETUP_SECRET remains accepted for deployment compatibility.
          </p>
        </div>
      )}

      {/* Password */}
      <div>
        <Label htmlFor="setup-password" className="mb-1.5 block text-xs text-foreground">
          Administrator password
        </Label>
        <div className="group relative flex items-center">
          <div className="absolute left-4 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
            <Lock className="h-4 w-4" aria-hidden="true" />
          </div>
          <Input
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
            className={cn(setupFieldClass, 'pr-11')}
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            aria-controls="setup-password"
            className={toggleClass}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="mt-2">
          <PasswordStrengthMeter password={password} context={passwordContext} />
        </div>
      </div>

      {/* Confirm Password */}
      <div>
        <Label htmlFor="setup-confirm-password" className="mb-1.5 block text-xs text-foreground">
          Confirm password
        </Label>
        <div className="group relative flex items-center">
          <div className="absolute left-4 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
            <Lock className="h-4 w-4" aria-hidden="true" />
          </div>
          <Input
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
            aria-invalid={(confirmPassword && !passwordsMatch) || undefined}
            aria-describedby={confirmPassword ? 'setup-confirm-password-match' : undefined}
            className={cn(
              setupFieldClass,
              'pr-11',
              confirmPassword && !passwordsMatch && 'border-destructive'
            )}
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(v => !v)}
            aria-label={
              showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'
            }
            aria-pressed={showConfirmPassword}
            aria-controls="setup-confirm-password"
            className={toggleClass}
          >
            {showConfirmPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {confirmPassword && (
          <p
            id="setup-confirm-password-match"
            className={`flex items-center gap-1.5 text-xs pt-1.5 ${
              passwordsMatch ? 'text-status-ok' : 'text-destructive'
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
