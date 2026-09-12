'use client';
/* eslint-disable react-hooks/set-state-in-effect -- existing prop-to-alert synchronization */

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import Image from 'next/image';
import Spinner from '@/components/ui/Spinner';
import SsoButton from '@/components/auth/SsoButton';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import HelloGreeting from '@/components/auth/HelloGreeting';
import { Mail, Lock, Eye, EyeOff, AlertCircle, X, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { purgeBrowserAuthCaches } from '@/lib/auth-cache-purge';
import { safeInternalCallbackUrl } from '@/lib/auth-redirect';

type Props = {
  callbackUrl: string;
  errorCode?: string | null;
  passwordSet?: boolean;
  ssoError?: string | null;
  ssoEnabled: boolean;
  ssoProviderType?: string | null;
  ssoProviderLabel?: string | null;
  localAuthEnabled: boolean;
  breakGlassOnly?: boolean;
};

function formatError(message: string | null | undefined) {
  if (!message) return '';
  // NextAuth appends ?error=SessionRequired on unauthenticated redirects — not a real error
  if (message === 'SessionRequired') return '';
  if (message === 'CredentialsSignin') return 'Invalid email or password';
  if (message === 'AccessDenied') return 'Access denied';
  if (message === 'SessionExpired') return 'Your session has expired. Please sign in again.';
  if (message === 'OAuthSignin' || message === 'OAuthCallback')
    return 'SSO authentication failed. Please try again or contact your administrator.';
  if (message === 'Configuration')
    return 'Server configuration error. Please contact your administrator.';
  return 'Authentication failed. Please try again.';
}

export default function LoginClient({
  callbackUrl,
  errorCode,
  passwordSet: _passwordSet,
  ssoError,
  ssoEnabled,
  ssoProviderType,
  ssoProviderLabel,
  localAuthEnabled,
  breakGlassOnly,
}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(() => formatError(errorCode) || ssoError || '');
  const [showPassword, setShowPassword] = useState(false);
  const [isSSOLoading, setIsSSOLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  // Email validation
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  useEffect(() => {
    if (errorCode) setError(formatError(errorCode));
  }, [errorCode]);

  // Surface SSO configuration errors passed from the server component
  useEffect(() => {
    if (ssoError) setError(ssoError);
  }, [ssoError]);

  const handleSSO = async () => {
    setIsSSOLoading(true);
    try {
      await purgeBrowserAuthCaches();
      await signIn('oidc', { callbackUrl });
    } catch {
      setError('Connection failed');
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
    setError('');

    try {
      const result = await signIn('credentials', {
        redirect: false,
        email: email.trim(),
        password,
        rememberMe: rememberMe.toString(),
        callbackUrl,
      });

      if (!result?.ok) {
        setError(formatError(result?.error));
        setIsSubmitting(false);
        // Trigger shake animation
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
      } else {
        setIsSuccess(true);
        // `result.url` from NextAuth's credentials provider (with
        // redirect:false) is unreliable — depending on the original
        // callbackUrl it can come back pointing at the signin page
        // itself, breaking the post-login navigation. Use the
        // validated `callbackUrl` prop, guarded by the shared
        // same-origin sanitizer (blocks //evil.example, /login, signout).
        const safeTarget = safeInternalCallbackUrl(callbackUrl, '/');

        // Purge any stale Service Worker dynamic/RSC caches immediately
        void purgeBrowserAuthCaches();

        // Standard enterprise practice for post-authentication transition:
        // A hard navigation via window.location.assign() completely blows away
        // the client-side RSC router cache and forces a full server document
        // request with the newly issued session cookie.
        setTimeout(() => {
          window.location.assign(safeTarget);
        }, 200);
      }
    } catch {
      setError('Unexpected error');
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout isSuccess={isSuccess}>
      <AuthCard isSuccess={isSuccess}>
        {/* Brand Header */}
        <div className="text-center mb-7">
          <div className="flex items-center justify-center gap-2.5 mb-3.5">
            <Image
              src="/logo.png"
              alt="OpsKnight"
              width={32}
              height={32}
              className="h-8 w-8 2xl:h-10 2xl:w-10 object-contain"
              priority
              unoptimized
            />
            <span className="text-2xl 2xl:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
              OpsKnight
            </span>
          </div>
          <h2 className="text-3xl 2xl:text-4xl font-bold text-slate-950 dark:text-white mb-2 tracking-tight min-h-[1.25em] flex items-center justify-center">
            {isSuccess ? 'Station online.' : <HelloGreeting />}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-normal transition-colors duration-300">
            {isSuccess
              ? 'Pledge acknowledged. The bridge is yours.'
              : 'The watch never ends. Take your post.'}
          </p>
        </div>

        {/* Global Error Alert */}
        {error && (
          <div
            className={`mb-6 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-xs flex items-start gap-2.5 ${
              isShaking ? 'animate-shake' : ''
            }`}
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-red-800 dark:text-red-200 mb-0.5">
                Couldn&apos;t sign you in
              </p>
              <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
            <button
              onClick={() => setError('')}
              className="text-red-400 hover:text-red-600 dark:hover:text-red-300 transition"
              aria-label="Dismiss error"
            >
              <X className="h-3.5 w-3.5" />
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
              disabled={isSubmitting || isSuccess}
            />
            {localAuthEnabled && (
              <div className="relative my-4 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                </div>
                <span className="relative px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-background">
                  {breakGlassOnly ? 'or break-glass recovery' : 'or'}
                </span>
              </div>
            )}
          </div>
        )}

        {!ssoEnabled && !localAuthEnabled && (
          <div
            role="alert"
            className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
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
                className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div>
                  <p className="font-semibold">Emergency Break-Glass Recovery</p>
                  <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                    Standard local login is disabled. Only the designated break-glass administrator account is authorized.
                  </p>
                </div>
              </div>
            )}
            {/* Work Email */}
            <div>
              <label
                className={cn(
                  'block text-xs font-medium mb-1.5 transition-colors',
                  emailTouched && email && !isEmailValid
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-700 dark:text-slate-300'
                )}
              >
                Email
              </label>
              <div className="group relative flex items-center">
                <div className="absolute left-4 z-10 text-slate-400 dark:text-slate-500 group-focus-within:text-slate-800 dark:group-focus-within:text-slate-200 transition-colors pointer-events-none">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    if (error) setError('');
                  }}
                  onBlur={() => setEmailTouched(true)}
                  className="auth-input w-full h-11 2xl:h-12 pl-12 pr-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm 2xl:text-base shadow-xs hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100 focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-white/15 transition-all"
                  placeholder="you@company.com"
                  disabled={isSubmitting || isSuccess}
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

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <div className="group relative flex items-center">
                <div className="absolute left-4 z-10 text-slate-400 dark:text-slate-500 group-focus-within:text-slate-800 dark:group-focus-within:text-slate-200 transition-colors pointer-events-none">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  onKeyDown={e => {
                    setCapsLockOn(e.getModifierState('CapsLock'));
                  }}
                  className="auth-input w-full h-11 2xl:h-12 pl-12 pr-11 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm 2xl:text-base shadow-xs hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100 focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-white/15 transition-all"
                  placeholder="Enter your password"
                  disabled={isSubmitting || isSuccess}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 z-10 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={rememberMe}
                  onClick={() => !isSubmitting && !isSuccess && setRememberMe(!rememberMe)}
                  disabled={isSubmitting || isSuccess}
                  className="flex items-center gap-2.5 cursor-pointer select-none group focus:outline-none disabled:opacity-50"
                >
                  {/* Custom checkbox — focus ring shown on the box itself for keyboard users */}
                  <span
                    className={cn(
                      'h-4 w-4 rounded flex items-center justify-center border transition-all duration-150 shrink-0',
                      'group-focus-visible:ring-2 group-focus-visible:ring-slate-900 group-focus-visible:ring-offset-1 dark:group-focus-visible:ring-white',
                      rememberMe
                        ? 'bg-slate-900 border-slate-900 dark:bg-white dark:border-white'
                        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 group-hover:border-slate-500 dark:group-hover:border-slate-400'
                    )}
                  >
                    {rememberMe && (
                      <svg
                        className="h-2.5 w-2.5 text-white dark:text-slate-900"
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
                  <span className="text-xs text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200 transition-colors font-medium">
                    Remember me
                  </span>
                </button>

                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                >
                  Forgot password?
                </Link>
              </div>

              {capsLockOn && (
                <div className="flex items-center gap-1.5 text-amber-600 text-xs mt-1 font-medium">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Caps Lock is ON</span>
                </div>
              )}
            </div>

            {/* Primary CTA Button */}
            <button
              type="submit"
              disabled={isSubmitting || isSSOLoading || isSuccess}
              className={cn(
                'group relative w-full h-11 2xl:h-12 px-4 rounded-lg font-semibold text-sm 2xl:text-base text-white transition-all duration-150 flex items-center justify-center gap-2 mt-3 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.995]',
                isSuccess
                  ? 'bg-emerald-600 shadow-emerald-600/20 shadow-md'
                  : 'bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 border border-slate-900 dark:border-white shadow-sm shadow-slate-950/15 hover:shadow'
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

        {/* Setup Guide Link */}
        <div className="text-center text-xs text-slate-500 dark:text-slate-400 font-medium pt-3.5">
          Setting up OpsKnight?{' '}
          <a
            href="https://opsknight.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-semibold inline-flex items-center gap-0.5 hover:underline transition-colors ml-0.5"
          >
            Installation guide →
          </a>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
