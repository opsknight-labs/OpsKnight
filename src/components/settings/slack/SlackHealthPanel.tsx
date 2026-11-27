'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  RefreshCw,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { toneClasses } from '@/components/patterns';
import { cn } from '@/lib/utils';
import { notify as toast } from '@/lib/toast';
import { buildSlackAppManifestJson } from '@/lib/slack/app-manifest';
import {
  computeSlackScopeHealth,
  type SlackHealthReport,
  type SlackHealthStatus,
} from '@/lib/slack/health';

type HealthResponse = SlackHealthReport & { workspaceName: string | null };

const STATUS_META: Record<
  SlackHealthStatus,
  { icon: LucideIcon; tone: 'ok' | 'elevated' | 'critical'; label: string }
> = {
  ok: { icon: CheckCircle2, tone: 'ok', label: 'Passing' },
  warn: { icon: AlertTriangle, tone: 'elevated', label: 'Needs attention' },
  error: { icon: XCircle, tone: 'critical', label: 'Failing' },
};
/** An unknown status (e.g. from a newer server) reads as "needs attention", never a crash. */
const statusMeta = (status: string) =>
  STATUS_META[status as SlackHealthStatus] ?? STATUS_META.warn;

async function copyText(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Could not copy', { description: 'Select the text and copy it manually.' });
  }
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="w-24 shrink-0 text-2xs font-medium text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded border bg-background px-2 py-1 font-mono text-2xs text-foreground">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 p-0"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void copyText(value, label);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? (
          <Check className={cn('h-3.5 w-3.5', toneClasses('ok').text)} aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

/**
 * Shown above the channel list whenever the stored grant is missing anything the manifest declares.
 * Required gaps are critical; optional gaps mean the Slack app predates the current manifest.
 */
export function SlackScopeHealthNotice({
  scopes,
  baseUrl,
  isAdmin,
  onReconnect,
}: {
  scopes: string[];
  baseUrl: string;
  isAdmin: boolean;
  onReconnect: () => void;
}) {
  const health = useMemo(() => computeSlackScopeHealth(scopes), [scopes]);
  if (health.healthy) return null;
  const critical = health.missingRequired.length > 0;

  return (
    <div
      className={cn(
        'space-y-3 rounded-lg border p-4 text-xs sm:p-5',
        toneClasses(critical ? 'critical' : 'elevated').soft
      )}
      role={critical ? 'alert' : 'status'}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{critical ? 'Missing required Slack scopes' : 'Slack app manifest out of date'}</span>
      </div>
      <p className="leading-relaxed">
        {critical
          ? 'Core incident features will fail until these scopes are granted.'
          : 'Your Slack app was installed from an older manifest. Everything that worked before still works; these features stay off until you update it.'}{' '}
        Copy the current manifest, paste it under <em>App Manifest</em> in the Slack API console,
        save, then reconnect.
      </p>
      <ul className="space-y-1">
        {health.missingRequired.map(scope => (
          <li key={scope} className="flex flex-wrap items-baseline gap-x-2">
            <code className="font-mono font-semibold">{scope}</code>
            <span>required</span>
          </li>
        ))}
        {health.missingOptional.map(item => (
          <li key={item.scope} className="flex flex-wrap items-baseline gap-x-2">
            <code className="font-mono font-semibold">{item.scope}</code>
            <span>{item.enables}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 bg-background text-xs font-semibold"
          onClick={() => void copyText(buildSlackAppManifestJson({ baseUrl }), 'Manifest')}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copy manifest
        </Button>
        {isAdmin && (
          <Button
            type="button"
            size="sm"
            variant={critical ? 'destructive' : 'default'}
            className="h-8 gap-1.5 text-xs font-semibold"
            onClick={onReconnect}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Reconnect Slack
          </Button>
        )}
      </div>
    </div>
  );
}

async function fetchSlackHealth(): Promise<{ report: HealthResponse } | { error: string }> {
  try {
    const response = await fetch('/api/slack/health', { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { error: typeof body?.error === 'string' ? body.error : 'Health check failed.' };
    }
    const report = (body?.data ?? body) as Partial<HealthResponse> | null;
    // Never render a malformed body (an old server, a proxy page): the panel would throw and blank
    // the whole Slack settings page. Show the panel's error state instead.
    if (!report || !Array.isArray(report.checks) || typeof report.overall !== 'string') {
      return { error: 'Health check returned an unexpected response. Try again.' };
    }
    return { report: report as HealthResponse };
  } catch {
    return { error: 'Health check failed. Check your connection and try again.' };
  }
}

/**
 * Guided setup checklist plus live health, both driven by GET /api/slack/health so a step is only
 * ticked once OpsKnight has actually seen it work.
 */
export function SlackHealthPanel({
  baseUrl,
  testSent,
  refreshKey = 0,
}: {
  baseUrl: string;
  /** A test notification succeeded in this session. */
  testSent: boolean;
  /** Bump to re-run the checks (for example after a test message). */
  refreshKey?: number;
}) {
  const [report, setReport] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((result: { report: HealthResponse } | { error: string }) => {
    if ('report' in result) {
      setReport(result.report);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  const load = () => {
    setLoading(true);
    void fetchSlackHealth().then(apply);
  };

  useEffect(() => {
    void fetchSlackHealth().then(apply);
  }, [apply, refreshKey]);

  const check = (id: string) => report?.checks.find(item => item.id === id);
  const passing = (id: string) => check(id)?.status === 'ok';

  const steps = report
    ? [
        {
          id: 'create',
          title: 'Create the Slack app from the manifest',
          done: true,
          detail: 'Done when OpsKnight has your app credentials.',
        },
        {
          id: 'install',
          title: 'Install OpsKnight to your workspace',
          done: passing('connection'),
          detail: check('connection')?.detail ?? '',
        },
        {
          id: 'events',
          title: 'Verify events and interactivity',
          done: passing('inbound') && passing('signing_secret'),
          detail: passing('signing_secret')
            ? (check('inbound')?.detail ?? '')
            : (check('signing_secret')?.detail ?? ''),
          urls: [
            { label: 'Events URL', value: `${baseUrl}/api/slack/events` },
            { label: 'Interactivity', value: `${baseUrl}/api/slack/actions` },
            { label: 'Slash command', value: `${baseUrl}/api/slack/commands` },
          ],
        },
        {
          id: 'test',
          title: 'Send a test message',
          done: testSent,
          detail: testSent
            ? 'A test card reached Slack.'
            : 'Pick a channel below and press Send test. Then press Acknowledge on a real card to confirm buttons work.',
        },
        {
          id: 'squire',
          title: 'Turn on Squire in chat',
          done: passing('squire_chat'),
          detail: check('squire_chat')?.detail ?? '',
          href: '/settings/intelligence/ai',
        },
      ]
    : [];
  const doneCount = steps.filter(step => step.done).length;
  const overall = report ? statusMeta(report.overall) : null;

  return (
    <section
      aria-labelledby="slack-health-heading"
      className="space-y-5 rounded-lg border border-border bg-card p-5 shadow-xs sm:p-6"
    >
      <div className="flex flex-col justify-between gap-3 border-b pb-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h3 id="slack-health-heading" className="text-base font-semibold text-foreground">
            Setup and health
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Live checks against Slack. Steps tick once OpsKnight has seen them work.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {overall && (
            <Badge variant="outline" className={cn('text-2xs', toneClasses(overall.tone).soft)}>
              {overall.label}
            </Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" />
            Run checks
          </Button>
        </div>
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {error ? (
          <p
            className={cn('rounded-lg border p-3 text-xs', toneClasses('critical').soft)}
            role="alert"
          >
            {error}
          </p>
        ) : !report ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">
                Guided setup{' '}
                <span className="font-normal text-muted-foreground">
                  ({doneCount} of {steps.length} done)
                </span>
              </h4>
              <ol className="space-y-2">
                {steps.map((step, index) => (
                  <li key={step.id} className="rounded-lg border bg-muted/20 p-3">
                    <div className="flex items-start gap-2.5">
                      {step.done ? (
                        <CheckCircle2
                          className={cn('mt-0.5 h-4 w-4 shrink-0', toneClasses('ok').text)}
                          aria-hidden="true"
                        />
                      ) : (
                        <Circle
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-xs font-semibold text-foreground">
                          {index + 1}. {step.title}
                          <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                        </p>
                        {step.detail && (
                          <p className="text-2xs leading-snug text-muted-foreground">{step.detail}</p>
                        )}
                        {'urls' in step && step.urls && (
                          <div className="space-y-1.5 pt-1">
                            {step.urls.map(url => (
                              <CopyField key={url.label} label={url.label} value={url.value} />
                            ))}
                          </div>
                        )}
                        {'href' in step && step.href && !step.done && (
                          <Link
                            href={step.href}
                            className="inline-block text-2xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:underline"
                          >
                            Open Intelligence settings
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="min-w-0 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Health checks</h4>
              <ul className="space-y-2">
                {report.checks.map(item => {
                  const meta = statusMeta(item.status);
                  const Icon = meta.icon;
                  return (
                    <li key={item.id} className="flex items-start gap-2.5 rounded-lg border p-3">
                      <Icon
                        className={cn('mt-0.5 h-4 w-4 shrink-0', toneClasses(meta.tone).text)}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">
                          {item.label}
                          <span className="sr-only">: {meta.label}</span>
                        </p>
                        <p className="break-words text-2xs leading-snug text-muted-foreground">
                          {item.detail}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
