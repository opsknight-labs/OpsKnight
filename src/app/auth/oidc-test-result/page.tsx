import Link from 'next/link';
import { CheckCircle2, ShieldAlert, ArrowRight, ShieldCheck, ArrowLeft } from 'lucide-react';

export default async function OidcTestResultPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; revisionId?: string }>;
}) {
  const { outcome, revisionId } = await searchParams;
  const isVerified = outcome === 'verified';

  const policyUrl = `/settings/system?section=sso&authTab=policy${
    revisionId ? `&revisionId=${encodeURIComponent(revisionId)}` : ''
  }`;
  const connectionUrl = `/settings/system?section=sso&authTab=connection${
    revisionId ? `&revisionId=${encodeURIComponent(revisionId)}` : ''
  }`;

  return (
    <main className="min-h-[80vh] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-3.5">
          <div
            className={`p-3 rounded-xl ${
              isVerified
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {isVerified ? (
              <CheckCircle2 className="h-6 w-6" />
            ) : (
              <ShieldAlert className="h-6 w-6" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {isVerified
                ? 'Administrator sign-in verified!'
                : 'Administrator sign-in test failed'}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isVerified
                ? 'Identity Provider authentication succeeded'
                : 'Could not complete administrator verification'}
            </p>
          </div>
        </div>

        <div
          className={`rounded-xl border p-4 text-xs sm:text-sm leading-relaxed ${
            isVerified
              ? 'border-emerald-500/20 bg-emerald-500/5 text-foreground/90'
              : 'border-destructive/20 bg-destructive/5 text-destructive'
          }`}
        >
          {isVerified ? (
            <div className="space-y-2">
              <p>
                A real sign-in test succeeded with your identity provider. The administrator access requirement for this configuration is now fulfilled.
              </p>
              <p className="text-xs text-muted-foreground">
                Your production sign-in policy is still unchanged until you review and activate it in Sessions &amp; Policies.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p>
                The provider test did not verify administrator access. Common causes include unverified email, mismatched user claims, or missing same-account linking approval.
              </p>
              <p className="text-xs opacity-90">
                Your active sign-in policy and production provider remain unchanged and safe.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3 pt-2">
          {isVerified ? (
            <>
              <Link
                href={policyUrl}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
              >
                <ShieldCheck className="h-4 w-4" />
                Continue to Policy &amp; Activation
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
              <Link
                href={connectionUrl}
                className="w-full flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Return to Identity Provider settings
              </Link>
            </>
          ) : (
            <Link
              href={connectionUrl}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Return to Identity Provider to fix configuration
            </Link>
          )}

          <div className="text-center pt-2">
            <Link
              href="/recovery"
              className="text-xs text-muted-foreground hover:underline"
            >
              Emergency recovery drill console
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
