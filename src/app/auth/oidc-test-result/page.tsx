import Link from 'next/link';
import { cookies } from 'next/headers';
import { CheckCircle2, ShieldAlert, ArrowRight, ShieldCheck, ArrowLeft, Info } from 'lucide-react';
import {
  OIDC_TEST_RESULT_COOKIE,
  readOidcTestResult,
  type OidcTestResult,
} from '@/lib/auth-control/oidc-revisions';

export const dynamic = 'force-dynamic';

function settingsUrl(tab: 'policy' | 'connection', revisionId: string | null) {
  const search = new URLSearchParams({ section: 'sso', authTab: tab });
  if (revisionId) search.set('revisionId', revisionId);
  return `/settings/system?${search}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

function content(result: OidcTestResult) {
  if (result.outcome === 'verified')
    return {
      tone: 'success' as const,
      title: 'Administrator sign-in verified',
      subtitle: 'Your identity provider authenticated an OpsKnight administrator',
      body: [
        'A real sign-in test succeeded for this saved configuration. The administrator verification requirement is fulfilled.',
        `Verification remains valid until ${formatDate(result.expiresAt)}, provided the provider, administrator and sign-in origin do not change.`,
        'Your production sign-in policy is unchanged until you review and activate it.',
      ],
    };
  if (result.outcome === 'failed')
    return {
      tone: 'failure' as const,
      title: 'Administrator sign-in test failed',
      subtitle: 'Administrator verification was not recorded',
      body:
        result.reason === 'deleted'
          ? [
              'The configuration under test was deleted before sign-in completed.',
              'Your active sign-in policy and production provider are unchanged.',
            ]
          : [
              'The provider test did not verify administrator access. Common causes are an unverified email, mismatched claims or role mapping, or a missing linking authorization.',
              'Your active sign-in policy and production provider are unchanged.',
            ],
    };
  return {
    tone: 'neutral' as const,
    title: 'No test result to show',
    subtitle: 'This page only shows results recorded for this browser',
    body: [
      'The result may have expired, or the test was started in another browser. Check the configuration’s verification status in the authentication console.',
    ],
  };
}

export default async function OidcTestResultPage() {
  const result = await readOidcTestResult((await cookies()).get(OIDC_TEST_RESULT_COOKIE)?.value);
  const revisionId = result.outcome === 'unavailable' ? null : result.revisionId;
  const view = content(result);
  const Icon =
    view.tone === 'success' ? CheckCircle2 : view.tone === 'failure' ? ShieldAlert : Info;

  return (
    <main className="min-h-[80vh] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg min-w-0 rounded-2xl border bg-card p-5 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-3.5">
          <div
            className={`p-3 rounded-xl shrink-0 ${
              view.tone === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : view.tone === 'failure'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            <Icon className="h-6 w-6" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-foreground">{view.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{view.subtitle}</p>
          </div>
        </div>

        <div
          role="status"
          className={`rounded-xl border p-4 text-sm leading-relaxed space-y-2 ${
            view.tone === 'success'
              ? 'border-emerald-500/20 bg-emerald-500/5 text-foreground/90'
              : view.tone === 'failure'
                ? 'border-destructive/20 bg-destructive/5 text-foreground/90'
                : 'border-border bg-muted/30 text-foreground/90'
          }`}
        >
          {view.body.map(line => (
            <p key={line}>{line}</p>
          ))}
        </div>

        <div className="space-y-3 pt-2">
          {view.tone === 'success' ? (
            <>
              <Link
                href={settingsUrl('policy', revisionId)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Continue to Sessions &amp; Policies
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href={settingsUrl('connection', revisionId)}
                className="w-full flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Return to identity provider settings
              </Link>
            </>
          ) : (
            <Link
              href={settingsUrl(view.tone === 'failure' ? 'connection' : 'policy', revisionId)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Return to the authentication console
            </Link>
          )}
          <div className="text-center pt-2">
            <Link href="/recovery" className="text-xs text-muted-foreground hover:underline">
              Emergency recovery console
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
