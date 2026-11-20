'use client';

import { useHydrated } from '@/hooks/useHydrated';

import { useState, useSyncExternalStore } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthBrand from '@/components/auth/AuthBrand';
import Spinner from '@/components/ui/Spinner';
import SsoButton from '@/components/auth/SsoButton';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import HelloGreeting from '@/components/auth/HelloGreeting';
import { Mail, Lock, Eye, EyeOff, AlertCircle, X, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { purgeBrowserAuthCaches } from '@/lib/auth-cache-purge';
import { safeInternalCallbackUrl } from '@/lib/auth-redirect';
import { detectResponderSessionPolicy } from '@/lib/pwa-session-policy';
import { appRoutes } from '@/lib/app-routes';
import { promiseWithTimeout } from '@/lib/client-timeout';
import {
  type AuthMessage,
  sessionEndMessage,
  signInMessage,
  signInMessageFor,
} from '@/lib/auth-control/messages';

type Props = {
  callbackUrl: string;
  defaultCallbackUrl?: string;
  errorCode?: string | null;
  errorReference?: string | null;
  administratorsNotified?: boolean;
  endedReason?: string | null;
  passwordSet?: boolean;
  sessionRevoked?: boolean;
  ssoError?: string | null;
  ssoEnabled: boolean;
  ssoProviderType?: string | null;
  ssoProviderLabel?: string | null;
  localAuthEnabled: boolean;
  breakGlassOnly?: boolean;
};

const authFieldClass =
  'h-11 min-h-11 2xl:h-12 pl-12 rounded-xl bg-card text-base sm:text-sm 2xl:text-base shadow-xs hover:border-ring/50 transition-colors';

function plainMessage(detail: string): AuthMessage {
  return { title: 'Couldn’t sign you in', detail, action: '' };
}

const subscribeResponderSessionPolicy = (onStoreChange: () => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia('(display-mode: standalone)');
  media.addEventListener?.('change', onStoreChange);
  return () => media.removeEventListener?.('change', onStoreChange);
};

const standardResponderSessionPolicy = () => 'STANDARD' as const;

export default function LoginClient({
  callbackUrl,
  defaultCallbackUrl,
  errorCode,
  errorReference,
  administratorsNotified,
  endedReason,
  passwordSet,
  sessionRevoked,
  ssoError,
  ssoEnabled,
  ssoProviderType,
  ssoProviderLabel,
  localAuthEnabled,
  breakGlassOnly,
}: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const sessionPolicy = useSyncExternalStore(
    subscribeResponderSessionPolicy,
    detectResponderSessionPolicy,
    standardResponderSessionPolicy
  );
  const trustedPwa = sessionPolicy === 'TRUSTED_PWA';
  const effectiveFallback = defaultCallbackUrl || (trustedPwa ? '/m' : '/');
  const [rememberMeOverride, setRememberMeOverride] = useState<boolean | null>(null);
  const rememberMe = rememberMeOverride ?? trustedPwa;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<AuthMessage | null>(
    () => signInMessageFor(errorCode, { administratorsNotified }) ?? signInMessage(ssoError)
  );
  const [reference, setReference] = useState(errorReference ?? null);
  const [copied, setCopied] = useState(false);
  const endedNotice = sessionEndMessage(endedReason);
  const [showPassword, setShowPassword] = useState(false);
  const [isSSOLoading, setIsSSOLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPasswordSet, setShowPasswordSet] = useState(() => Boolean(passwordSet));
  const [isShaking, setIsShaking] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  // Email validation
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const emailInvalid = emailTouched && !!email && !isEmailValid;

  const dismissError = () => {
    setError(null);
    setReference(null);
  };

  const copyDetails = async () => {
    if (!error) return;
    const details = [
      error.title,
      reference ? `Reference: ${reference}` : null,
      errorCode ? `Code: ${errorCode}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleSSO = async () => {
    setIsSSOLoading(true);
    try {
      await promiseWithTimeout(purgeBrowserAuthCaches(), 5_000).catch(() => {});
      const safeSsoTarget = safeInternalCallbackUrl(callbackUrl, effectiveFallback);
      await promiseWithTimeout(
        signIn('oidc', { callbackUrl: safeSsoTarget }),
        15_000,
        'SSO sign-in timed out. Please try again.'
      );
    } catch (err: unknown) {
      setError(
        plainMessage(err instanceof Error && err.message ? err.message : 'Connection failed')
      );
    } finally {
      setIsSSOLoading(false);
    }
  };

  const handleCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !password) {
      if (!email) setEmailTouched(true);
      return;
    }

    setIsSubmitting(true);
    dismissError();

    try {
      const result = await promiseWithTimeout(
        signIn('credentials', {
          redirect: false,
          email: email.trim(),
          password,
          rememberMe: rememberMe.toString(),
          callbackUrl,
        }),
        15_000,
        'Sign-in request timed out. Please try again.'
      );

      if (!result?.ok) {
        setError(signInMessage(result?.error ?? 'CredentialsSignin'));
        setIsSubmitting(false);
        // Trigger shake animation
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
      } else {
        setIsSuccess(true);
        // `result.url` from NextAuth's credentials provider (with redirect:false)
        // is not authoritative for our validated callback. Use the shared
        // same-origin sanitizer and refresh the App Router after the session
        // cookie has been issued so authenticated RSC data is fetched anew.
        const safeTarget = safeInternalCallbackUrl(callbackUrl, effectiveFallback);
        await promiseWithTimeout(purgeBrowserAuthCaches(), 5_000).catch(() => {});
        if (typeof window !== 'undefined') {
          window.location.assign(safeTarget);
        } else {
          router.replace(safeTarget);
          router.refresh();
        }
      }
    } catch (err: unknown) {
      setError(
        plainMessage(err instanceof Error && err.message ? err.message : 'Unexpected error')
      );
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout isSuccess={isSuccess}>
      <AuthCard isSuccess={isSuccess}>
        {/* Brand Header */}
        <div className="text-center mb-7">
          <div className="flex items-center justify-center mb-3.5">
            <AuthBrand size="hero" />
          </div>
          <h2 className="text-2xl sm:text-3xl 2xl:text-4xl font-bold text-foreground mb-2 tracking-tight min-h-[1.25em] flex items-center justify-center">
            {isSuccess ? 'Station online.' : <HelloGreeting />}
          </h2>
          <p className="text-sm text-muted-foreground font-normal transition-colors duration-300">
            {isSuccess
              ? 'Pledge acknowledged. The bridge is yours.'
              : 'The watch never ends. Take your post.'}
          </p>
        </div>

        {endedNotice && !error && !sessionRevoked && (
          <div
            role="status"
            className={cn(
              'mb-6 rounded-lg border p-3 text-sm',
              endedNotice.tone === 'notice'
                ? 'border-status-elevated/30 bg-status-elevated-soft text-status-elevated-deep'
                : 'border-destructive/30 bg-destructive/5 text-destructive'
            )}
          >
            <p className="text-xs font-semibold">{endedNotice.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed opacity-90">
              {endedNotice.detail} {endedNotice.action}
            </p>
          </div>
        )}
        {sessionRevoked && !error && (
          <div
            role="status"
            className="mb-6 rounded-lg border border-status-ok/30 bg-status-ok-soft p-3 text-sm text-status-ok-deep"
          >
            Your session was revoked successfully. Sign in again to continue.
          </div>
        )}
        {/* Password Set Success Alert */}
        {showPasswordSet && !error && (
          <div
            role="status"
            className="mb-6 p-3 rounded-lg border border-status-ok/30 bg-status-ok-soft/30 shadow-xs flex items-start gap-3"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-status-ok/15 text-status-ok mt-0.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground mb-0.5">
                Password set successfully
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your account is active. Please sign in with your new password.
              </p>
            </div>
            <button
              type="button"
              data-icon-button
              onClick={() => setShowPasswordSet(false)}
              className="relative shrink-0 flex h-6 w-6 min-h-0 min-w-0 p-0 after:absolute after:-inset-2.5 after:content-[''] items-center justify-center rounded-full border border-input/70 bg-muted hover:bg-accent text-foreground transition-all cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss message"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5 stroke-[2.5]" />
            </button>
          </div>
        )}

        {/* Global Error Alert */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className={cn(
              'mb-6 p-3 rounded-lg border shadow-xs flex items-start gap-3 transition-all',
              error.tone === 'notice'
                ? 'border-status-elevated/30 bg-status-elevated-soft/40'
                : 'border-destructive/30 bg-destructive/5',
              isShaking && 'animate-shake'
            )}
          >
            <div
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-md mt-0.5',
                error.tone === 'notice'
                  ? 'bg-status-elevated/15 text-status-elevated-deep'
                  : 'bg-destructive/10 text-destructive'
              )}
            >
              <AlertCircle className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground mb-0.5">{error.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{error.detail}</p>
              {error.action && (
                <p className="mt-1 text-xs text-foreground leading-relaxed">{error.action}</p>
              )}
              {(reference || error.docsHref) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                  {reference && (
                    <span>
                      Reference <code className="font-mono">{reference}</code>
                    </span>
                  )}
                  {reference && (
                    <button
                      type="button"
                      onClick={copyDetails}
                      className="font-semibold text-foreground underline-offset-2 hover:underline"
                    >
                      {copied ? 'Copied' : 'Copy details for your administrator'}
                    </button>
                  )}
                  {error.docsHref && (
                    <a
                      href={error.docsHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-foreground underline-offset-2 hover:underline"
                    >
                      Learn more
                    </a>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              data-icon-button
              onClick={dismissError}
              className={cn(
                "relative shrink-0 flex h-6 w-6 min-h-0 min-w-0 p-0 after:absolute after:-inset-2.5 after:content-[''] items-center justify-center rounded-full border transition-all cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2",
                error.tone === 'notice'
                  ? 'border-status-elevated/30 bg-status-elevated/15 hover:bg-status-elevated/25 text-status-elevated-deep focus-visible:ring-status-elevated/50'
                  : 'border-destructive/30 bg-destructive/10 hover:bg-destructive/20 text-destructive focus-visible:ring-destructive/50'
              )}
              aria-label="Dismiss error"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5 stroke-[2.5]" />
            </button>
          </div>
        )}

        {/* SSO is independent from local credentials. In SSO-only mode this
            remains the primary (and only) authentication mechanism. */}
        {ssoEnabled && (
          <div className={localAuthEnabled ? 'mb-4' : ''}>
            <SsoButton
              providerType={ssoProviderType as 'google' | 'okta' | 'azure' | 'auth0' | 'custom'}
              providerLabel={ssoProviderLabel}
              onClick={handleSSO}
              loading={isSSOLoading}
              disabled={!hydrated || isSubmitting || isSuccess}
            />
            {localAuthEnabled && (
              <div className="relative my-4 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <span className="relative px-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground bg-background">
                  {breakGlassOnly ? 'or break-glass recovery' : 'or'}
                </span>
              </div>
            )}
          </div>
        )}

        {!ssoEnabled && !localAuthEnabled && (
          <div
            role="alert"
            className="rounded-xl border border-status-elevated/30 bg-status-elevated-soft p-4 text-sm text-status-elevated-deep"
          >
            No authentication method is available. Contact your administrator to configure SSO or
            enable local login.
          </div>
        )}

        {localAuthEnabled && (
          <form onSubmit={handleCredentials} className="space-y-4">
            {breakGlassOnly && (
              <div
                role="alert"
                className="rounded-xl border border-status-elevated/30 bg-status-elevated-soft p-3 text-xs text-status-elevated-deep flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-status-elevated mt-0.5" />
                <div>
                  <p className="font-semibold">Emergency Break-Glass Recovery</p>
                  <p className="mt-0.5 text-status-elevated-deep">
                    Standard local login is disabled. Only the designated break-glass administrator
                    account is authorized.
                  </p>
                </div>
              </div>
            )}
            {/* Work Email */}
            <div className="space-y-1.5">
              <Label
                htmlFor="login-email"
                className={cn('text-xs', emailInvalid ? 'text-destructive' : 'text-foreground')}
              >
                Email
              </Label>
              <div className="group relative flex items-center">
                <div className="absolute left-4 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                </div>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    if (error) dismissError();
                  }}
                  onBlur={() => setEmailTouched(true)}
                  aria-invalid={emailInvalid || undefined}
                  aria-describedby={emailInvalid ? 'login-email-error' : undefined}
                  className={cn(authFieldClass, 'pr-4', emailInvalid && 'border-destructive')}
                  placeholder="you@company.com"
                  disabled={!hydrated || isSubmitting || isSuccess}
                />
                {emailInvalid && (
                  <div className="absolute right-3 z-10 text-destructive" aria-hidden="true">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                )}
              </div>
              {emailInvalid && (
                <p id="login-email-error" className="text-xs text-destructive font-medium">
                  Please enter a valid email address
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="login-password" className="text-xs text-foreground">
                Password
              </Label>
              <div className="group relative flex items-center">
                <div className="absolute left-4 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
                  <Lock className="h-4 w-4" aria-hidden="true" />
                </div>
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    if (error) dismissError();
                  }}
                  onKeyDown={e => {
                    setCapsLockOn(e.getModifierState('CapsLock'));
                  }}
                  aria-describedby={capsLockOn ? 'login-password-capslock' : undefined}
                  className={cn(authFieldClass, 'pr-11')}
                  placeholder="Enter your password"
                  disabled={!hydrated || isSubmitting || isSuccess}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 z-10 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>

              <div className="flex flex-wrap items-start justify-between gap-y-2 gap-x-4 pt-1">
                <div className="min-w-0">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={rememberMe}
                    aria-describedby={trustedPwa ? 'login-remember-help' : undefined}
                    onClick={() =>
                      !isSubmitting && !isSuccess && setRememberMeOverride(!rememberMe)
                    }
                    disabled={!hydrated || isSubmitting || isSuccess}
                    className="flex items-center gap-2.5 cursor-pointer select-none group focus:outline-none disabled:opacity-50"
                  >
                    {/* Custom checkbox — focus ring shown on the box itself for keyboard users */}
                    <span
                      className={cn(
                        'h-4 w-4 rounded flex items-center justify-center border transition-all duration-150 shrink-0',
                        'group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-1',
                        rememberMe
                          ? 'bg-primary border-primary'
                          : 'border-input bg-card group-hover:border-ring'
                      )}
                    >
                      {rememberMe && (
                        <svg
                          className="h-2.5 w-2.5 text-primary-foreground"
                          viewBox="0 0 10 8"
                          fill="none"
                        >
                          <path
                            d="M1 4l3 3 5-6"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors font-medium">
                      {trustedPwa ? 'Trusted responder device' : 'Remember me'}
                    </span>
                  </button>
                  {trustedPwa && (
                    <p
                      id="login-remember-help"
                      className="mt-1 max-w-[18rem] text-2xs leading-4 text-muted-foreground"
                    >
                      Installed PWA: stay signed in for up to 90 days. Turn this off on a shared
                      device.
                    </p>
                  )}
                </div>

                <Link
                  href={appRoutes.forgotPassword(
                    effectiveFallback.startsWith('/m') || trustedPwa ? 'mobile' : 'desktop'
                  )}
                  className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-0.5"
                >
                  Forgot password?
                </Link>
              </div>

              {capsLockOn && (
                <div
                  id="login-password-capslock"
                  className="flex items-center gap-1.5 text-status-elevated-deep text-xs mt-1 font-medium"
                >
                  <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Caps Lock is ON</span>
                </div>
              )}
            </div>

            {/* Primary CTA Button */}
            <button
              type="submit"
              disabled={isSubmitting || isSSOLoading || isSuccess}
              aria-busy={isSubmitting || undefined}
              className={cn(
                'group relative w-full h-11 2xl:h-12 px-4 rounded-lg font-semibold text-sm 2xl:text-base transition-all duration-150 flex items-center justify-center gap-2 mt-3 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.995]',
                isSuccess
                  ? 'bg-status-ok text-white shadow-md'
                  : 'bg-primary hover:bg-primary/90 text-primary-foreground border border-primary shadow-sm hover:shadow'
              )}
            >
              {isSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Authorized</span>
                </>
              ) : isSubmitting ? (
                <>
                  <Spinner size="sm" variant="white" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign in</span>
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
          </form>
        )}

        <p className="text-center text-sm pt-4">
          <Link
            href="/login/emergency"
            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Emergency Access
          </Link>
        </p>
        {/* Setup Guide Link */}
        <div className="text-center text-xs text-muted-foreground font-medium pt-3.5">
          Setting up OpsKnight?{' '}
          <a
            href="https://opsknight.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground font-semibold inline-flex items-center gap-0.5 hover:underline transition-colors ml-0.5"
          >
            Installation guide →
          </a>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
