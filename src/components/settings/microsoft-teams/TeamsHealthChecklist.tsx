import { AlertTriangle, CheckCircle2, CircleHelp, Download, KeyRound, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { toneClasses } from '@/components/patterns/status-tone';
import type {
  TeamsHealthChecklist as Checklist,
  TeamsHealthCheckStatus,
} from '@/lib/microsoft-teams/health-checklist';
import {
  describeTeamsSecretExpiry,
  getTeamsSecretExpiryState,
} from '@/lib/microsoft-teams/secret-expiry';
import type { TeamsTestResult } from './teams-test-result';

const STATUS_META: Record<
  TeamsHealthCheckStatus,
  { label: string; tone: 'ok' | 'elevated' | 'critical' | 'neutral'; Icon: typeof CheckCircle2 }
> = {
  pass: { label: 'Passing', tone: 'ok', Icon: CheckCircle2 },
  warn: { label: 'Needs attention', tone: 'elevated', Icon: AlertTriangle },
  fail: { label: 'Failing', tone: 'critical', Icon: XCircle },
  unknown: { label: 'Not verified', tone: 'neutral', Icon: CircleHelp },
};

/** Inline outcome of "Send test card" for one destination. */
export function TeamsTestResultMessage({ result }: { result: TeamsTestResult }) {
  if (result.ok) {
    return <p className={`text-xs ${toneClasses('ok').text}`}>{result.message}</p>;
  }
  const extra = [result.code, result.detail].filter(Boolean).join(' · ');
  return (
    <div className={`rounded-md border p-2 text-xs ${toneClasses('critical').soft}`}>
      <p className="font-medium">{result.message}</p>
      {extra ? (
        <p className="mt-0.5 font-mono text-2xs wrap-break-word opacity-80">{extra}</p>
      ) : null}
    </div>
  );
}

const PACKAGE_URL = '/api/microsoft-teams/package';

/** Secret-expiry banner: shown from 30 days before expiry and after it. */
export function TeamsSecretExpiryBanner({
  expiresAt,
}: {
  expiresAt: string | Date | null | undefined;
}) {
  const state = getTeamsSecretExpiryState(expiresAt ?? null);
  if (state.level !== 'soon' && state.level !== 'urgent' && state.level !== 'expired') return null;
  const tone = state.level === 'soon' ? 'elevated' : 'critical';
  return (
    <div
      role={state.level === 'soon' ? 'status' : 'alert'}
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${toneClasses(tone).soft}`}
    >
      <KeyRound className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold">
          {state.level === 'expired'
            ? 'Microsoft Teams client secret has expired'
            : 'Microsoft Teams client secret expires soon'}
        </p>
        <p className="text-xs">
          {describeTeamsSecretExpiry(state)} Save the new secret and its expiry date in Setup &amp;
          Credentials.
        </p>
      </div>
    </div>
  );
}

/** Step-by-step guidance for moving existing installs to the current app package. */
export function TeamsAppUpdateGuide({ checklist }: { checklist: Checklist | null }) {
  if (!checklist) return null;
  const versionCheck = checklist.checks.find(c => c.id === 'app_version');
  if (!versionCheck || versionCheck.status === 'pass') return null;
  if (!checklist.checks.some(c => c.id === 'installation' && c.status === 'pass')) return null;
  return (
    <section
      aria-labelledby="teams-app-update-heading"
      className={`rounded-xl border p-4 sm:p-5 space-y-3 ${toneClasses(checklist.appUpdateAvailable ? 'elevated' : 'info').soft}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="teams-app-update-heading" className="text-sm font-semibold">
            {checklist.appUpdateAvailable
              ? `Update the OpsKnight app in Teams to v${checklist.currentAppVersion}`
              : `Make sure Teams runs app v${checklist.currentAppVersion}`}
          </h3>
          <p className="text-xs mt-0.5">
            This release lets people @mention OpsKnight, use commands such as{' '}
            <span className="font-medium">status</span> and{' '}
            <span className="font-medium">help</span>, and chat with Squire. Cards and buttons keep
            working on the old package until you update.
          </p>
        </div>
        <Button asChild size="sm" className="h-9 text-xs shrink-0 w-full sm:w-auto">
          <a href={PACKAGE_URL} download>
            <Download className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            Download updated app package
          </a>
        </Button>
      </div>
      <ol className="list-decimal pl-5 space-y-1 text-xs">
        <li>Download the updated package above.</li>
        <li>
          In the Teams admin center, open{' '}
          <span className="font-medium">Teams apps → Manage apps</span>, find OpsKnight and choose{' '}
          <span className="font-medium">Upload file</span> to replace it. If you sideloaded the app,
          use <span className="font-medium">Apps → Manage your apps → Update</span> in Teams
          instead.
        </li>
        <li>
          Teams may ask a Team owner to accept the update. Existing channels, cards and permissions
          stay as they are.
        </li>
        <li>
          Come back here and refresh: this checklist confirms the new version when Microsoft Graph
          can read it.
        </li>
      </ol>
    </section>
  );
}

export function TeamsHealthChecklist({ checklist }: { checklist: Checklist | null }) {
  if (!checklist) {
    return (
      <div className="rounded-xl border bg-card p-5 text-xs text-muted-foreground">
        The health checklist couldn&rsquo;t run. Refresh the page to try again.
      </div>
    );
  }
  const failing = checklist.checks.filter(c => c.status === 'fail').length;
  const warnings = checklist.checks.filter(c => c.status === 'warn').length;
  return (
    <section
      aria-labelledby="teams-health-checklist-heading"
      className="rounded-xl border bg-card p-5 sm:p-6 shadow-xs space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h3 id="teams-health-checklist-heading" className="text-sm font-semibold">
          Health checklist
        </h3>
        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
          {failing > 0
            ? `${failing} failing, ${warnings} to review`
            : warnings > 0
              ? `${warnings} to review`
              : 'Everything checked is working'}{' '}
          · checked {new Date(checklist.generatedAt).toLocaleTimeString()}
        </p>
      </div>
      <ul className="divide-y rounded-lg border">
        {checklist.checks.map(check => {
          const meta = STATUS_META[check.status];
          const tone = toneClasses(meta.tone);
          return (
            <li key={check.id} className="flex items-start gap-3 p-3 text-xs">
              <meta.Icon
                className={`h-4 w-4 mt-0.5 shrink-0 ${meta.tone === 'neutral' ? 'text-muted-foreground' : tone.text}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-foreground">{check.label}</span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-semibold ${tone.soft}`}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="text-muted-foreground wrap-break-word">{check.detail}</p>
                {check.code && check.status !== 'pass' ? (
                  <p className="text-2xs text-muted-foreground/80 font-mono">Code: {check.code}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-2xs text-muted-foreground" suppressHydrationWarning>
        App package: current v{checklist.currentAppVersion}
        {checklist.installedAppVersion ? ` · installed v${checklist.installedAppVersion}` : ''}
        {checklist.lastInboundActivityAt
          ? ` · last message from Teams ${new Date(checklist.lastInboundActivityAt).toLocaleString()}`
          : ''}
      </p>
    </section>
  );
}
