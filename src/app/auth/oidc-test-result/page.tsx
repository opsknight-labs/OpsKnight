import Link from 'next/link';
import { cookies } from 'next/headers';
import {
  CheckCircle2,
  ShieldAlert,
  ArrowRight,
  ShieldCheck,
  ArrowLeft,
  Info,
  Wrench,
  BookOpen,
} from 'lucide-react';
import {
  OIDC_TEST_RESULT_COOKIE,
  readOidcTestResult,
  type OidcTestDiagnostics,
  type OidcTestResult,
} from '@/lib/auth-control/oidc-revisions';
import { ADMIN_TEST_DOCS, adminTestMessage, type AuthSetupStep } from '@/lib/auth-control/messages';

export const dynamic = 'force-dynamic';

function settingsUrl(tab: AuthSetupStep, revisionId: string | null) {
  const search = new URLSearchParams({ section: 'sso', authTab: tab });
  if (revisionId) search.set('revisionId', revisionId);
  return `/settings/system?${search}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

type View = {
  tone: 'success' | 'failure' | 'neutral';
  title: string;
  subtitle: string;
  body: string[];
  fix?: { step: AuthSetupStep; label: string };
  docsHref?: string;
};

function content(result: OidcTestResult): View {
  if (result.outcome === 'verified')
    return {
      tone: 'success',
      title: 'Administrator sign-in verified',
      subtitle: 'Your identity provider authenticated an OpsKnight administrator',
      body: [
        'A real sign-in test succeeded for this saved configuration.',
        `It stays valid until ${formatDate(result.expiresAt)} unless the provider, role rules, administrator or application URL change.`,
        'Nothing changes for other people until you review and activate single sign-on.',
      ],
    };
  if (result.outcome === 'failed') {
    const message = adminTestMessage(result.code);
    return {
      tone: message.tone === 'notice' ? 'neutral' : 'failure',
      title: message.title,
      subtitle: 'The administrator test did not pass. Production sign-in is unchanged.',
      body: [message.detail, message.action],
      fix: message.fix,
      docsHref: `${ADMIN_TEST_DOCS}#${result.code.toLowerCase()}`,
    };
  }
  return {
    tone: 'neutral',
    title: 'No test result to show',
    subtitle: 'This page only shows results recorded for this browser',
    body: [
      'The result may have expired (results are kept for 15 minutes), or the test was started in another browser. Run the test again from the authentication console.',
    ],
  };
}

function ClaimValue({ value }: { value: string | boolean | string[] | null }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">empty list</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map(item => (
          <code key={item} className="rounded bg-muted px-1.5 py-0.5 text-[11px] break-all">
            {item}
          </code>
        ))}
      </span>
    );
  }
  if (value === null) return <span className="text-muted-foreground">not readable</span>;
  return <code className="text-[11px] break-all">{String(value)}</code>;
}

function Diagnostics({ diagnostics }: { diagnostics: OidcTestDiagnostics }) {
  const entries = Object.entries(diagnostics.claims ?? {});
  if (
    entries.length === 0 &&
    !diagnostics.providerMessage &&
    !diagnostics.role &&
    !diagnostics.receivedEmail
  )
    return null;
  return (
    <section aria-labelledby="test-diagnostics" className="rounded-xl border p-4 space-y-3">
      <h2 id="test-diagnostics" className="text-sm font-semibold text-foreground">
        What OpsKnight received
      </h2>
      {diagnostics.providerMessage && (
        <p className="text-xs">
          <span className="font-medium">Provider message: </span>
          <code className="break-all">{diagnostics.providerMessage}</code>
        </p>
      )}
      {(diagnostics.receivedEmail || diagnostics.expectedEmail) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Email from provider</dt>
          <dd>
            <code>{diagnostics.receivedEmail ?? 'none'}</code>
          </dd>
          <dt className="text-muted-foreground">Your OpsKnight email</dt>
          <dd>
            <code>{diagnostics.expectedEmail ?? 'unknown'}</code>
          </dd>
        </dl>
      )}
      {diagnostics.role && (
        <p className="text-xs">
          <span className="font-medium">Role rules: </span>
          {diagnostics.role.result}
          {diagnostics.role.effectiveRole && (
            <>
              {' '}
              → role would be <strong>{diagnostics.role.effectiveRole}</strong>
            </>
          )}
        </p>
      )}
      {entries.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-2 text-xs">
          {entries.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="font-mono text-muted-foreground">{name}</dt>
              <dd className="min-w-0">
                <ClaimValue value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {diagnostics.claimNames && diagnostics.claimNames.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            All claim names in the ID token ({diagnostics.claimNames.length})
          </summary>
          <p className="mt-2 font-mono break-words text-muted-foreground">
            {diagnostics.claimNames.join(', ')}
          </p>
        </details>
      )}
      <p className="text-[11px] text-muted-foreground">
        Only claim names and the values OpsKnight uses for access decisions are shown. Tokens are
        never stored.
      </p>
    </section>
  );
}

export default async function OidcTestResultPage() {
  const result = await readOidcTestResult((await cookies()).get(OIDC_TEST_RESULT_COOKIE)?.value);
  const revisionId = result.outcome === 'unavailable' ? null : result.revisionId;
  const view = content(result);
  const Icon =
    view.tone === 'success' ? CheckCircle2 : view.tone === 'failure' ? ShieldAlert : Info;

  return (
    <main className="min-h-[80vh] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl min-w-0 rounded-2xl border bg-card p-5 sm:p-8 shadow-sm space-y-6">
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

        {result.outcome !== 'unavailable' && <Diagnostics diagnostics={result.diagnostics} />}

        <div className="space-y-3 pt-2">
          {view.tone === 'success' ? (
            <>
              <Link
                href={settingsUrl('policy', revisionId)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Continue to review and activate
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
            <>
              <Link
                href={settingsUrl(view.fix?.step ?? 'connection', revisionId)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
              >
                <Wrench className="h-4 w-4" aria-hidden />
                {view.fix?.label ?? 'Return to the authentication console'}
              </Link>
              {view.docsHref && (
                <a
                  href={view.docsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden />
                  How to fix this
                </a>
              )}
            </>
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
