'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import SsoButton from '@/components/auth/SsoButton';
import Spinner from '@/components/ui/Spinner';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  AlertTriangle,
  X,
  CheckCircle2,
  Check,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculatePasswordStrength } from '@/lib/password-strength';
import { purgeBrowserAuthCaches } from '@/lib/auth-cache-purge';

type Props = {
  callbackUrl: string;
  ssoEnabled: boolean;
  ssoProviderType?: string | null;
  ssoProviderLabel?: string | null;
  errorCode?: string | null;
  ssoError?: string | null;
  passwordSet?: boolean;
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

export default function MobileLoginClient({
  callbackUrl,
  errorCode,
  passwordSet,
  ssoError,
  ssoEnabled,
  ssoProviderType,
  ssoProviderLabel,
}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Mobile defaults Remember Me ON: on mobile, server-side revocation
  // (tokenVersion bump) is the only way to log out — matches the
  // PagerDuty/Linear model. The auth.ts authorize() also forces this
  // for any mobile UA as a defense in depth, but reflecting it in the
  // UI lets the user know.
  const [rememberMe, setRememberMe] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSSOLoading, setIsSSOLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Password strength
  const passwordStrength = calculatePasswordStrength(password);

  const notices: Array<{
    id: string;
    tone: 'success' | 'warning';
    title: string;
    message: string;
  }> = [];

  if (passwordSet) {
    notices.push({
      id: 'password-set',
      tone: 'success',
      title: 'Password updated',
      message: 'Sign in with your new credentials.',
    });
  }

  if (ssoError) {
    notices.push({
      id: 'sso-error',
      tone: 'warning',
      title: 'SSO unavailable',
      message: ssoError,
    });
  }

  useEffect(() => {
    if (errorCode) setError(formatError(errorCode));
  }, [errorCode]);

  useEffect(() => {
    setIsValid(Boolean(email) && Boolean(password));
  }, [email, password]);

  let safeCallbackUrl = callbackUrl;
  // Ensure we redirect to mobile dashboard /m unless specific deep link
  if (
    !safeCallbackUrl ||
    safeCallbackUrl === '/' ||
    safeCallbackUrl.includes('/login') ||
    safeCallbackUrl.includes('/auth') || // Catches /auth/signout
    !safeCallbackUrl.startsWith('/m')
  ) {
    safeCallbackUrl = '/m';
  }

  const handleSSO = async () => {
    setIsSSOLoading(true);
    setError('');
    try {
      let finalCallbackUrl = callbackUrl;
      if (
        !finalCallbackUrl ||
        finalCallbackUrl === '/' ||
        finalCallbackUrl.includes('/login') ||
        finalCallbackUrl.includes('/auth/signout')
      ) {
        finalCallbackUrl = '/m';
      }
      await purgeBrowserAuthCaches();
      await signIn('oidc', { callbackUrl: finalCallbackUrl });
    } catch {
      setError('Connection failed');
      setIsSSOLoading(false);
    }
  };

  const handleCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValid) return;

    setIsSubmitting(true);
    setError('');

    try {
      const result = await signIn('credentials', {
        redirect: false,
        email: email.trim(),
        password,
        rememberMe: String(rememberMe),
        callbackUrl: safeCallbackUrl,
      });

      if (result?.error) {
        setError(formatError(result.error));
        setIsSubmitting(false);
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
      } else if (result?.ok) {
        setIsSubmitting(false);
        setIsSuccess(true);
        const target =
          safeCallbackUrl &&
          safeCallbackUrl.startsWith('/') &&
          !safeCallbackUrl.startsWith('/login') &&
          !safeCallbackUrl.includes('/auth/signout')
            ? safeCallbackUrl
            : '/m';

        // Purge any stale Service Worker dynamic/RSC caches immediately
        void purgeBrowserAuthCaches();

        // Standard enterprise practice for post-authentication transition:
        // A hard navigation via window.location.assign() completely blows away
        // the client-side RSC router cache and forces a full server document
        // request with the newly issued session cookie.
        setTimeout(() => {
          window.location.assign(target);
        }, 200);
      }
    } catch {
      setError('Unexpected error');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 text-slate-900 flex flex-col">
      {/* Header */}
      <div className="relative w-full bg-gradient-to-b from-indigo-50/50 to-slate-50 pt-8 pb-4 rounded-b-[1.5rem]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center justify-center gap-1.5"
        >
          <Link href="/" className="relative group">
            <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <img src="/logo.svg" alt="OpsKnight" className="relative h-12 w-12 drop-shadow-lg" />
          </Link>
          <span className="text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 font-display drop-shadow-sm">
            OpsKnight
          </span>
        </motion.div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col px-6 pb-8">
        <div className="w-full max-w-sm mx-auto">
          {/* Page Title */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 font-display">
              {isSuccess ? 'Access Granted' : 'Secure Mobile Login'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isSuccess
                ? 'Redirecting to your mobile command center.'
                : 'Verify your identity to reach OpsKnight Mobile.'}
            </p>
          </div>

          {/* Notices */}
          {notices.length > 0 && (
            <div className="mb-6 space-y-3">
              {notices.map(notice => {
                const isSuccessTone = notice.tone === 'success';
                const Icon = isSuccessTone ? Sparkles : AlertTriangle;
                return (
                  <div
                    key={notice.id}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3 text-sm',
                      isSuccessTone
                        ? 'border-slate-200 bg-white text-slate-700 shadow-sm'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 mt-0.5 shrink-0',
                        isSuccessTone ? 'text-slate-500' : 'text-amber-600'
                      )}
                    />
                    <div>
                      <p className="font-medium">{notice.title}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{notice.message}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Error Alert */}
          {error && (
            <div
              role="alert"
              className={cn(
                'mb-6 p-3 rounded-lg bg-red-50 border border-red-200 text-sm flex items-start gap-3',
                isShaking && 'animate-shake'
              )}
            >
              <AlertCircle className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
              <p className="flex-1 text-red-700">{error}</p>
              <button
                onClick={() => setError('')}
                className="text-red-400 hover:text-red-700 transition-colors"
                aria-label="Dismiss error"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* SSO Button */}
          {ssoEnabled && (
            <div className="mb-6">
              <SsoButton
                providerType={ssoProviderType as 'google' | 'okta' | 'azure' | 'auth0' | 'custom'}
                providerLabel={ssoProviderLabel}
                onClick={handleSSO}
                loading={isSSOLoading}
                disabled={isSubmitting || isSuccess}
              />
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-slate-50 px-4 text-slate-400">or</span>
                </div>
              </div>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleCredentials} className="space-y-5">
            {/* Email Field */}
            <div className="group space-y-2">
              <label
                className={`text-xs font-bold uppercase tracking-wider transition-colors duration-300 ${
                  emailTouched && email && !isEmailValid
                    ? 'text-red-500'
                    : 'text-slate-500 group-focus-within:text-slate-900'
                }`}
              >
                Identification
              </label>
              <div className="relative group/input">
                <div className="relative flex items-center pr-3 group-focus-within:border-slate-400 bg-white rounded-xl border border-slate-200 shadow-sm transition-colors duration-300">
                  <div className="flex items-center justify-center pl-4 pr-3 py-3.5 border-r border-slate-100">
                    <Mail className="h-5 w-5 text-slate-400 transition-colors group-focus-within/input:text-slate-600" />
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
                    className="auth-input w-full bg-transparent px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none transition-colors"
                    placeholder="you@opsknight.com"
                    disabled={isSubmitting || isSuccess}
                  />
                  {emailTouched && email && !isEmailValid && (
                    <div className="absolute right-3 text-red-500 animate-in fade-in zoom-in duration-200">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                  )}
                </div>
              </div>
              {emailTouched && email && !isEmailValid && (
                <p className="text-[10px] text-red-500 font-medium pl-1 animate-in slide-in-from-top-1">
                  Please enter a valid email address
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="group space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 transition-colors duration-300 group-focus-within:text-slate-900">
                  Access Key
                </label>
                <Link
                  href="/m/forgot-password"
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors focus:outline-none focus:underline"
                >
                  Forgot password?
                </Link>
              </div>

              <div className="relative group/input">
                <div className="relative flex items-center pr-3 group-focus-within:border-slate-400 bg-white rounded-xl border border-slate-200 shadow-sm transition-all duration-300">
                  <div className="flex items-center justify-center pl-4 pr-3 py-3.5 border-r border-slate-100">
                    <Lock className="h-5 w-5 text-slate-400 transition-colors group-focus-within/input:text-slate-600" />
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
                      if (e.getModifierState('CapsLock')) {
                        setCapsLockOn(true);
                      } else {
                        setCapsLockOn(false);
                      }
                    }}
                    className="auth-input w-full bg-transparent px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none transition-colors"
                    placeholder="••••••••"
                    disabled={isSubmitting || isSuccess}
                  />
                  <div className="flex items-center border-l border-slate-100 pl-3">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-slate-400 hover:text-slate-600 transition-colors focus:outline-none p-1 rounded-md"
                      aria-label="Toggle password visibility"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Password Strength Indicator */}
              {password && !isSuccess && (
                <div className="space-y-1 pt-1 duration-200 animate-in fade-in slide-in-from-top-1">
                  <div className="flex gap-1 h-1 w-full overflow-hidden rounded-full bg-slate-200">
                    {[1, 2, 3, 4, 5].map(level => (
                      <div
                        key={level}
                        className={cn(
                          'h-full flex-1 transition-all duration-500',
                          level <= (passwordStrength.score + 1) * 1.25
                            ? passwordStrength.color
                            : 'bg-transparent'
                        )}
                      />
                    ))}
                  </div>
                  <p
                    className={cn('text-[10px] font-medium text-right', passwordStrength.textColor)}
                  >
                    Strength: {passwordStrength.label}
                  </p>
                </div>
              )}

              {capsLockOn && (
                <div className="flex items-center gap-2 text-amber-600 text-xs animate-pulse font-medium pl-1">
                  <AlertCircle className="h-3 w-3" />
                  <span>Caps Lock is ON</span>
                </div>
              )}
            </div>

            {/* Remember Me */}
            <div
              className="flex items-center group cursor-pointer"
              onClick={() => !isSubmitting && !isSuccess && setRememberMe(!rememberMe)}
            >
              <div
                className={cn(
                  'h-5 w-5 rounded-md border flex items-center justify-center transition-all duration-200',
                  rememberMe
                    ? 'bg-slate-800 border-slate-800 shadow-sm'
                    : 'bg-white border-slate-300 group-hover:border-slate-400 shadow-sm'
                )}
              >
                {rememberMe && <Check className="h-3.5 w-3.5 text-white stroke-[3]" />}
              </div>
              <input
                id="remember-me"
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                disabled={isSubmitting || isSuccess}
                className="sr-only"
              />
              <label className="ml-3 text-sm text-slate-600 group-hover:text-slate-900 transition-colors cursor-pointer select-none">
                Remember me
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || isSSOLoading || !isValid || isSuccess}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-sm font-semibold transition-all duration-200',
                isSuccess
                  ? 'bg-slate-900 text-white shadow-lg'
                  : 'bg-slate-900 text-white hover:bg-slate-800 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isSuccess ? (
                <>
                  <CheckCircle2 className="h-5 w-5" />
                  <span>Success</span>
                </>
              ) : isSubmitting ? (
                <>
                  <Spinner size="sm" variant="white" />
                  <span>Signing in...</span>
                </>
              ) : (
                <span>Sign in</span>
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="mt-8 text-center text-xs text-slate-400">Secured by OpsKnight</p>
        </div>
      </main>
    </div>
  );
}
