'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Spinner from '@/components/ui/Spinner';
import { Eye, EyeOff, Lock, AlertTriangle, CheckCircle2, ShieldCheck, X } from 'lucide-react';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import { cn } from '@/lib/utils';
import { calculatePasswordStrength } from '@/lib/password-strength';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Password strength using centralized utility
  const passwordStrength = calculatePasswordStrength(password);
  const isStrong = passwordStrength.meetsMinimum && passwordStrength.score >= 4;

  if (!token) {
    return (
      <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-200 text-sm flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-rose-400 mb-1">Invalid Token</p>
          <p className="text-white/70">
            Invalid or missing reset token. Please request a new link.
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!isStrong) {
      setError('Please create a stronger password');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to reset password');
      } else {
        setSuccess(true);

        // Clear all NextAuth session cookies to prevent token version mismatch
        // This ensures no stale session interferes with fresh login
        document.cookie = 'next-auth.session-token=; Max-Age=0; path=/; SameSite=Lax';
        document.cookie =
          '__Secure-next-auth.session-token=; Max-Age=0; path=/; Secure; SameSite=Lax';
        document.cookie = 'next-auth.csrf-token=; Max-Age=0; path=/; SameSite=Lax';
        document.cookie = '__Host-next-auth.csrf-token=; Max-Age=0; path=/; Secure; SameSite=Lax';

        // Redirect after success
        setTimeout(() => {
          router.push('/login?password=1');
        }, 2000);
      }
    } catch (_err) {
      setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center text-center gap-4">
          <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-emerald-400">Password Reset!</h3>
            <p className="mt-2 text-sm text-emerald-200/80">
              Your password has been successfully updated. Secure session initialized.
            </p>
          </div>
        </div>
        <div className="text-center text-xs text-white/40 animate-pulse">
          Redirecting to login...
        </div>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-200 text-sm flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
          <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-rose-400 mb-1">Reset Failed</p>
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

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-5">
          {/* New Password */}
          <div className="group space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-white/60 transition-colors duration-300 group-focus-within:text-white/80">
              New Password
            </label>
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
                  className="w-full bg-transparent px-4 py-3 text-white placeholder:text-white/20 focus:outline-none transition-colors"
                  placeholder="New strong password"
                  autoComplete="new-password"
                  disabled={isSubmitting}
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

            {/* Strength Indicator */}
            {password && (
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
                <p className={cn('text-[10px] font-medium text-right', passwordStrength.textColor)}>
                  Strength: {passwordStrength.label}
                </p>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="group space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-white/60 transition-colors duration-300 group-focus-within:text-white/80">
              Confirm Password
            </label>
            <div className="relative group/input">
              <div className="absolute inset-0 bg-white/5 rounded-xl transition duration-300 group-hover/input:bg-white/10" />
              <div className="absolute inset-[1px] bg-[#0a0a0a] rounded-[11px]" />

              <div className="relative flex items-center pr-3 group-focus-within:border-white/30 group-focus-within:bg-white/5 rounded-xl border border-white/10 transition-all duration-300">
                <div className="flex items-center justify-center pl-4 pr-3 py-3.5 border-r border-white/10">
                  <Lock className="h-5 w-5 text-white/40 transition-colors group-focus-within/input:text-white/70" />
                </div>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={e => {
                    setConfirmPassword(e.target.value);
                    if (error) setError('');
                  }}
                  className="w-full bg-transparent px-4 py-3 text-white placeholder:text-white/20 focus:outline-none transition-colors"
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  disabled={isSubmitting}
                />
                <div className="flex items-center border-l border-white/10 pl-3">
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="text-white/30 hover:text-white/80 transition-colors focus:outline-none p-1 rounded-md"
                    aria-label="Toggle password visibility"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
            {confirmPassword && password !== confirmPassword && (
              <p className="text-[10px] text-rose-400 font-medium pl-1 animate-in slide-in-from-top-1 flex items-center gap-1">
                <X className="h-3 w-3" /> Passwords do not match
              </p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !isStrong || password !== confirmPassword}
          className="relative w-full overflow-hidden rounded-lg py-3.5 text-sm font-bold shadow-lg transition-all duration-300 bg-white text-black hover:bg-white/95 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-cyan-400/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg"
        >
          <span className="relative z-10 flex items-center justify-center gap-2 uppercase tracking-wide">
            {isSubmitting ? (
              <>
                <Spinner size="sm" variant="black" />
                <span>Updating...</span>
              </>
            ) : (
              <>
                <span>Set New Password</span>
                <ShieldCheck className="h-4 w-4" />
              </>
            )}
          </span>
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <AuthCard>
        {/* Card Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-extrabold tracking-tight text-white tracking-tight flex items-center gap-3">
            <span className="flex items-center gap-3">
              <span className="w-1.5 h-6 bg-white/20 rounded-full" />
              Reset Password
            </span>
          </h2>
          <p className="mt-2 text-sm text-white/50 pl-0.5">
            Secure your account with a strong password.
          </p>
        </div>

        <Suspense
          fallback={
            <div className="flex justify-center p-8">
              <Spinner variant="white" />
            </div>
          }
        >
          <ResetPasswordForm />
        </Suspense>
      </AuthCard>
    </AuthLayout>
  );
}
