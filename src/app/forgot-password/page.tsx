'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail, ArrowLeft, Send, CheckCircle2, AlertCircle, X } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { AuthLayout, AuthCard } from '@/components/auth/AuthLayout';
import AuthBrand from '@/components/auth/AuthBrand';
import { fetchWithTimeout } from '@/lib/client-timeout';
import { appRoutes } from '@/lib/app-routes';
import { cn } from '@/lib/utils';

const GENERIC_MESSAGE =
  'If an account exists with this email, you will receive password reset instructions.';

export default function ForgotPasswordPage() {
  const pathname = usePathname();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState('');
  const loginHref = appRoutes.login(pathname?.startsWith('/m') ? 'mobile' : 'desktop');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetchWithTimeout(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ email }),
        },
        12_000
      );
      if (!response.ok) throw new Error('request_failed');
      setIsSent(true);
    } catch {
      setError('Unable to submit the recovery request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout isSuccess={isSent}>
      <AuthCard>
        <div className="mb-8 text-center">
          <AuthBrand className="mb-6" />
          <h1 className="font-display text-2xl font-bold text-foreground">
            {isSent ? 'Check your inbox' : 'Account recovery'}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {isSent
              ? 'If the account exists, recovery instructions will arrive shortly.'
              : 'Enter your email to request a password reset link.'}
          </p>
        </div>
        {isSent ? (
          <div className="space-y-4" role="status" aria-live="polite">
            <div className="rounded-xl border border-status-ok/30 bg-status-ok-soft p-4 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-status-ok" />
              <p className="mt-2 text-sm text-status-ok-deep">{GENERIC_MESSAGE}</p>
            </div>
            <Link
              href={loginHref}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs shadow-xs transition-all"
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive mt-0.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                </div>
                <p id="email-error" className="flex-1 text-foreground leading-relaxed pt-0.5">
                  {error}
                </p>
                <button
                  type="button"
                  data-icon-button
                  onClick={() => setError('')}
                  aria-label="Dismiss error"
                  title="Dismiss"
                  className="relative shrink-0 flex h-6 w-6 min-h-0 min-w-0 p-0 after:absolute after:-inset-2.5 after:content-[''] items-center justify-center rounded-full bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5 stroke-[2.25]" />
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs text-foreground">
                  Email address
                </Label>
                <div className="group relative flex items-center">
                  <div className="absolute left-3.5 z-10 text-muted-foreground group-focus-within:text-foreground transition-colors pointer-events-none">
                    <Mail className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => {
                      setEmail(e.target.value);
                      setError('');
                    }}
                    maxLength={254}
                    autoComplete="email"
                    required
                    disabled={isSubmitting}
                    placeholder="you@company.com"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'email-error' : 'email-help'}
                    className={cn(
                      'h-11 min-h-11 2xl:h-12 pl-10 pr-4 rounded-xl bg-card text-sm shadow-xs hover:border-ring/50 transition-colors',
                      error && 'border-destructive'
                    )}
                    autoFocus
                  />
                </div>
                <p id="email-help" className="text-xs text-muted-foreground">
                  Use the address you sign in with.
                </p>
              </div>
              <button
                type="submit"
                disabled={isSubmitting || !email}
                aria-busy={isSubmitting || undefined}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {isSubmitting ? (
                  <>
                    <Spinner size="sm" variant="current" /> Sending…
                  </>
                ) : (
                  <>
                    Send reset link <Send className="h-4 w-4" />
                  </>
                )}
              </button>
              <div className="text-center">
                <Link
                  href={loginHref}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to sign in
                </Link>
              </div>
            </form>
          </>
        )}
      </AuthCard>
    </AuthLayout>
  );
}
