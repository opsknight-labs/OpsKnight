'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import Spinner from '@/components/ui/Spinner';
import SsoButton from '@/components/auth/SsoButton';
import LoginTicker from '@/components/auth/LoginTicker';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import { Mail, Lock, Eye, EyeOff, AlertCircle, X, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculatePasswordStrength } from '@/lib/password-strength';
import { purgeBrowserAuthCaches } from '@/lib/auth-cache-purge';

type Props = {
  callbackUrl: string;
  errorCode?: string | null;
  passwordSet?: boolean;
  ssoError?: string | null;
  ssoEnabled: boolean;
  ssoProviderType?: string | null;
  ssoProviderLabel?: string | null;
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
}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSSOLoading, setIsSSOLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  // Email validation
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Password strength using centralized utility
  const passwordStrength = calculatePasswordStrength(password);

  useEffect(() => {
    if (errorCode) setError(formatError(errorCode));
  }, [errorCode]);

  // Surface SSO configuration errors passed from the server component
  useEffect(() => {
    if (ssoError) setError(ssoError);
  }, [ssoError]);

  useEffect(() => {
    setIsValid(Boolean(email) && Boolean(password));
  }, [email, password]);

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
    if (!isValid) return;

    setIsSubmitting(true);
    setError('');

    try {
      const result = await signIn('credentials', {
        redirect: false,
        email: email.trim(),
        password,
        rememberMe: String(rememberMe),
        callbackUrl,
      });

      if (result?.error) {
        setError(formatError(result.error));
        setIsSubmitting(false);
        // Trigger shake animation
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
      } else if (result?.ok) {
        setIsSubmitting(false);
        setIsSuccess(true);
        // `result.url` from NextAuth's credentials provider (with
        // redirect:false) is unreliable — depending on the original
        // callbackUrl it can come back pointing at the signin page
        // itself, breaking the post-login navigation. Use the
        // validated `callbackUrl` prop, guarded against /login loop.
        const safeTarget =
          callbackUrl &&
          callbackUrl.startsWith('/') &&
          !callbackUrl.startsWith('/login') &&
          !callbackUrl.includes('/auth/signout')
            ? callbackUrl
            : '/';

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
    <AuthLayout>
      <AuthCard isSuccess={isSuccess}>
        {/* Card Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-extrabold tracking-tight text-white tracking-tight flex items-center gap-3">
            {isSuccess ? (
              <span className="text-emerald-400 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <CheckCircle2 className="w-6 h-6" />
                Access Granted
              </span>
            ) : (
              <span className="flex items-center gap-3">
                <span className="w-1.5 h-6 bg-white/20 rounded-full" />
                OpsKnight Secure Access
              </span>
            )}
          </h2>
          <p className="mt-2 text-sm text-white/50 pl-0.5">
            {isSuccess
              ? 'Redirecting to secure console...'
              : 'Enter your credentials to access the secure console.'}
          </p>
        </div>

        {/* Global Error Alert */}
        {error && (
          <div
            className={`mb-6 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-200 text-sm flex items-start gap-3 ${
              isShaking ? 'animate-shake' : ''
            }`}
          >
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-500 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-rose-400 mb-1">Authentication Error</p>
              <p className="text-white/70">{error}</p>
            </div>
            <button
              onClick={() => setError('')}
              className="text-white/40 hover:text-white transition"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {ssoEnabled && (
          <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
            <SsoButton
              providerType={ssoProviderType as 'google' | 'okta' | 'azure' | 'auth0' | 'custom'}
              providerLabel={ssoProviderLabel}
              onClick={handleSSO}
              loading={isSSOLoading}
              disabled={isSubmitting || isSuccess}
            />
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-wider font-bold">
                <span className="bg-[#0a0a0a] px-3 text-white/30">Or sign in with</span>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleCredentials} className="space-y-6">
          <div className="space-y-5">
            {/* Email Field */}
            <div className="group space-y-2">
              <label
                className={`text-xs font-bold uppercase tracking-wider transition-colors duration-300 ${
                  emailTouched && email && !isEmailValid
                    ? 'text-rose-400'
                    : 'text-white/60 group-focus-within:text-white/80'
                }`}
              >
                Identification
              </label>
              <div className="relative group/input">
                <div className="absolute inset-0 bg-white/5 rounded-xl transition duration-300 group-hover/input:bg-white/10" />
                <div className="absolute inset-[1px] bg-[#0a0a0a] rounded-[11px]" />

                <div className="relative flex items-center pr-3 group-focus-within:border-white/30 group-focus-within:bg-white/5 rounded-xl border border-white/10 transition-colors duration-300">
                  <div className="flex items-center justify-center pl-4 pr-3 py-3.5 border-r border-white/10">
                    <Mail className="h-5 w-5 text-white/40 transition-colors group-focus-within/input:text-white/70" />
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
                    className="auth-input w-full bg-transparent px-4 py-3 text-white placeholder:text-white/20 focus:outline-none transition-colors"
                    placeholder="you@opsknight.com"
                    disabled={isSubmitting || isSuccess}
                  />
                  {emailTouched && email && !isEmailValid && (
                    <div className="absolute right-3 text-rose-400 animate-in fade-in zoom-in duration-200">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                  )}
                </div>
              </div>
              {emailTouched && email && !isEmailValid && (
                <p className="text-[10px] text-rose-400 font-medium pl-1 animate-in slide-in-from-top-1">
                  Please enter a valid email address
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="group space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-white/60 transition-colors duration-300 group-focus-within:text-white/80">
                  Access Key
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-emerald-500/80 hover:text-emerald-400 transition-colors focus:outline-none focus:underline"
                >
                  Forgot password?
                </Link>
              </div>

              <div className="relative group/input">
                <div className="absolute inset-0 bg-white/5 rounded-xl transition duration-300 group-hover/input:bg-white/10" />
                <div className="absolute inset-[1px] bg-[#0a0a0a] rounded-[11px]" />

                <div className="relative flex items-center pr-3 group-focus-within:border-white/30 group-focus-within:bg-white/5 rounded-xl border border-white/10 transition-all duration-300">
                  <div className="flex items-center justify-center pl-4 pr-3 py-3.5 border-r border-white/10">
                    <Lock className="h-5 w-5 text-white/40 transition-colors group-focus-within/input:text-white/70" />
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
                    className="auth-input w-full bg-transparent px-4 py-3 text-white placeholder:text-white/20 focus:outline-none transition-colors"
                    placeholder="••••••••"
                    disabled={isSubmitting || isSuccess}
                  />
                  <div className="flex items-center border-l border-white/10 pl-3">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-white/30 hover:text-white/80 transition-colors focus:outline-none p-1 rounded-md"
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
                  <div className="flex gap-1 h-1 w-full overflow-hidden rounded-full bg-white/5">
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
                <div className="flex items-center gap-2 text-amber-400 text-xs animate-pulse font-medium pl-1">
                  <AlertCircle className="h-3 w-3" />
                  <span>Caps Lock is ON</span>
                </div>
              )}
            </div>

            {/* Remember Me */}
            <fieldset>
              <legend className="sr-only">Login options</legend>
              <label htmlFor="remember-me" className="flex items-center gap-3 group cursor-pointer">
                <div className="relative flex items-center">
                  <input
                    id="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    disabled={isSubmitting || isSuccess}
                    className="peer h-4 w-4 opacity-0 absolute cursor-pointer"
                  />
                  <div className="h-4 w-4 rounded border border-white/20 bg-white/5 transition-all peer-checked:border-emerald-500 peer-checked:bg-emerald-500 peer-focus:ring-2 peer-focus:ring-emerald-500/20 pointer-events-none" />
                  <svg
                    className="pointer-events-none absolute left-0.5 top-0.5 h-3 w-3 text-black opacity-0 transition-opacity peer-checked:opacity-100"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-xs text-white/60 select-none hover:text-white transition font-medium">
                  Remember me
                </span>
              </label>
            </fieldset>

            <button
              type="submit"
              disabled={isSubmitting || isSSOLoading || !isValid || isSuccess}
              className={`relative w-full overflow-hidden rounded-lg py-3.5 text-sm font-bold shadow-lg transition-all duration-300
                  ${
                    isSuccess
                      ? 'bg-emerald-500 text-white scale-[1.02] shadow-emerald-500/25 ring-2 ring-emerald-400/50'
                      : 'bg-white text-black hover:bg-white/95 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-cyan-400/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg'
                  }
              `}
            >
              <span className="relative z-10 flex items-center justify-center gap-2 uppercase tracking-wide">
                {isSuccess ? (
                  <>
                    <span>Authorized</span>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </>
                ) : isSubmitting ? (
                  <>
                    <Spinner size="sm" variant="black" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M14 5l7 7m0 0l-7 7m7-7H3"
                      />
                    </svg>
                  </>
                )}
              </span>
            </button>

            {/* Keyboard Hint */}
            {isValid && !isSubmitting && !isSuccess && (
              <div className="flex items-center justify-center gap-2 text-[10px] text-white/30 mt-3">
                <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] font-mono">
                  ↵
                </kbd>
                <span>Press Enter to sign in</span>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.15em] text-white/40 mt-8 font-medium">
              <svg
                className="h-3.5 w-3.5 text-emerald-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              <span>Your Operations, Our Sentinel.</span>
            </div>
          </div>
        </form>
      </AuthCard>

      <LoginTicker />
    </AuthLayout>
  );
}
