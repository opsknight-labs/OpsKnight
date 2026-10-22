'use client';

import { useId, useState } from 'react';
import { ChevronDown, FlaskConical, Play, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';

import { ManualSample } from './ManualSample';
import { TraceDetail } from './TraceDetail';
import { Hint, NativeSelect, textareaClass } from './authoring/primitives';

import type { testAutomation } from '@/lib/automation/testing';
import type { Data } from './presentation-types';

function recentAlertLabel(alert: Data['alerts'][number]) {
  const payload = (
    alert.payload && typeof alert.payload === 'object' ? alert.payload : {}
  ) as Record<string, unknown>;
  return [
    typeof payload.severity === 'string' ? payload.severity : 'Alert',
    typeof payload.source === 'string' ? payload.source : 'Integration',
    typeof payload.summary === 'string' ? payload.summary.slice(0, 160) : 'Recent alert',
    new Date(alert.createdAt).toLocaleString(),
  ].join(' · ');
}

export function AutomationTest({
  data,
  integrationId,
  setIntegrationId,
  setIntegrationType,
  sample,
  setSample,
  providerSample,
  setProviderSample,
  busy,
  runTest,
  result,
}: {
  data: Data;
  integrationId: string;
  setIntegrationId: (value: string) => void;
  setIntegrationType: (value: string) => void;
  sample: string;
  setSample: (value: string) => void;
  providerSample: string;
  setProviderSample: (value: string) => void;
  busy: boolean;
  runTest: () => Promise<void>;
  result: Awaited<ReturnType<typeof testAutomation>> | null;
}) {
  const id = useId();
  const [selectedAlertId, setSelectedAlertId] = useState<string>('');
  const selectedAlert = data.alerts.find(a => a.id === selectedAlertId);
  const outcome = result?.result?.outcome;
  const policyName =
    outcome?.type === 'ESCALATION_POLICY'
      ? data.policies.find(policy => policy.id === outcome.policyId)?.name
      : null;
  const errors = result?.issues.filter(issue => issue.level === 'ERROR').length ?? 0;

  return (
    <div className="grid min-w-0 gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section
        aria-labelledby={`${id}-input`}
        className="min-w-0 space-y-3.5 rounded-xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-xs"
      >
        <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
          <div>
            <h3
              id={`${id}-input`}
              className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
            >
              <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
              Sample event
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Sample tests use the production evaluator and create no incidents or notifications.
            </p>
          </div>
          <Badge
            variant="outline"
            className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            Sandbox
          </Badge>
        </div>

        {data.canReadSensitive === false && (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
            Recent alert samples require sensitive incident access. You can test a sample you
            provide below.
          </p>
        )}

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-alert`} className="text-xs font-medium text-foreground">
              Use recent alert
            </Label>
            <NativeSelect
              id={`${id}-alert`}
              disabled={!data.alerts.length}
              className="h-8.5 text-xs bg-background"
              value={selectedAlertId}
              onChange={e => {
                const alert = data.alerts.find(a => a.id === e.target.value);
                if (alert) {
                  setSelectedAlertId(alert.id);
                  if (alert.integrationId) {
                    setIntegrationId(alert.integrationId);
                    setIntegrationType(
                      alert.integrationType ??
                        data.integrations.find(i => i.id === alert.integrationId)?.type ??
                        'EVENTS_API'
                    );
                  }
                  if (alert.providerSample && Object.keys(alert.providerSample).length > 0) {
                    setProviderSample(JSON.stringify(alert.providerSample, null, 2));
                  } else {
                    setProviderSample('{}');
                  }
                  setSample(
                    JSON.stringify(
                      {
                        event_action: 'trigger',
                        dedup_key: alert.dedupKey ?? 'sample',
                        payload: alert.payload,
                      },
                      null,
                      2
                    )
                  );
                } else {
                  setSelectedAlertId('');
                }
              }}
            >
              <option value="">
                {data.alerts.length ? 'Choose recent alert…' : 'No recent alerts available'}
              </option>
              {data.alerts.map(a => (
                <option key={a.id} value={a.id}>
                  {recentAlertLabel(a)}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${id}-integration`} className="text-xs font-medium text-foreground">
              Integration
            </Label>
            <NativeSelect
              id={`${id}-integration`}
              className="h-8.5 text-xs bg-background"
              value={integrationId}
              onChange={e => {
                setIntegrationId(e.target.value);
                setIntegrationType(
                  data.integrations.find(i => i.id === e.target.value)?.type ?? 'EVENTS_API'
                );
              }}
            >
              <option value="">Events API</option>
              {data.integrations.map(i => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        {selectedAlert && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-1.5 text-xs">
            <span className="font-medium text-foreground/90">
              Replay mode: Normalized alert only (raw provider payload unavailable)
            </span>
          </div>
        )}

        <Hint>
          Recent alerts replay the normalized OpsKnight event only; full raw provider payloads are
          not retained for replay to prevent sensitive credential leakage. If rules require
          provider-specific mappings, paste a raw provider sample under Advanced sample JSON.
        </Hint>

        <ManualSample onBuild={setSample} />

        <details className="group rounded-lg border border-border/70 bg-background/50">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 text-xs font-medium text-foreground/90 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
            Advanced sample JSON
            <ChevronDown
              className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="grid gap-3 border-t border-border/70 p-3 xl:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label
                htmlFor={`${id}-event`}
                className="text-[11px] font-medium text-muted-foreground"
              >
                Paste sample event · Normalized event
              </Label>
              <textarea
                id={`${id}-event`}
                spellCheck={false}
                className={cn(textareaClass, 'min-h-48 font-mono text-xs')}
                value={sample}
                onChange={e => setSample(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <Label
                htmlFor={`${id}-provider`}
                className="text-[11px] font-medium text-muted-foreground"
              >
                Provider input
              </Label>
              <textarea
                id={`${id}-provider`}
                spellCheck={false}
                className={cn(textareaClass, 'min-h-48 font-mono text-xs')}
                value={providerSample}
                onChange={e => setProviderSample(e.target.value)}
              />
            </div>
          </div>
        </details>

        <Button
          size="sm"
          className="h-8.5 gap-1.5 text-xs font-medium shadow-xs"
          disabled={busy}
          onClick={() => void runTest()}
        >
          <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          Test sample
        </Button>
      </section>

      <section
        aria-labelledby={`${id}-result`}
        aria-busy={busy}
        className="min-w-0 space-y-3.5 rounded-xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-xs"
      >
        <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
          <h3 id={`${id}-result`} className="text-sm font-semibold tracking-tight text-foreground">
            Result
          </h3>
          {result && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] tabular-nums font-medium text-muted-foreground"
            >
              {result.durationMs.toFixed(2)} ms
            </Badge>
          )}
        </div>

        {!result ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 p-10 text-center text-xs text-muted-foreground bg-muted/5">
            <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            </div>
            <p className="font-semibold text-foreground text-xs">Ready for simulation</p>
            <p className="mt-1 max-w-sm text-muted-foreground">
              Run a sample event to trace rule matches, priority overrides, and responder route
              decisions.
            </p>
          </div>
        ) : (
          <>
            <p role="status" className="text-xs text-muted-foreground">
              {result.durationMs.toFixed(2)} ms ·{' '}
              {result.goldenResults.filter(f => f.expected === f.actual).length}/
              {result.goldenResults.length} semantic fixtures passed
            </p>

            <dl className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs">
                <dt className="text-muted-foreground text-[11px]">Base classification</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {result.classification?.priority ?? 'Unset'} ·{' '}
                  {result.classification?.urgency ?? 'Unknown'}
                </dd>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs">
                <dt className="text-muted-foreground text-[11px]">Draft checks</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {result.issues.length === 0
                    ? 'No issues'
                    : `${errors} ${errors === 1 ? 'error' : 'errors'} · ${result.issues.length - errors} ${result.issues.length - errors === 1 ? 'warning' : 'warnings'}`}
                </dd>
              </div>
            </dl>

            {result.providerFieldsMissing && result.providerFieldsMissing.length > 0 && (
              <div
                role="alert"
                className="rounded-lg border border-amber-500/40 bg-amber-50/70 p-2.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <p className="font-semibold">Provider-only mapping unavailable</p>
                <p className="mt-0.5 text-[11px]">
                  {result.providerFieldsMissing.join(', ')} cannot be extracted because no raw
                  provider sample was supplied. Enter a provider sample in Advanced sample JSON to
                  test provider mappings.
                </p>
              </div>
            )}

            {result.issues.length > 0 && (
              <ul aria-label="Draft issues" className="space-y-1.5 text-xs">
                {result.issues.map((i, n) => (
                  <li
                    key={n}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs',
                      i.level === 'ERROR'
                        ? 'border-destructive/40 bg-destructive/5 text-destructive'
                        : 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                    )}
                  >
                    <span className="font-semibold">{i.level}:</span> {i.message}
                  </li>
                ))}
              </ul>
            )}

            {result.result && (
              <div className="pt-1">
                <TraceDetail
                  detail={{
                    result: result.result,
                    policyName,
                    destinationNames: data.destinations.map(destination => ({
                      provider: destination.provider,
                      destinationId: destination.id,
                      label: destination.channelName,
                    })),
                    normalization: 'normalization' in result ? result.normalization : [],
                    actual: {
                      priority: result.classification?.priority,
                      route: 'SERVICE_DEFAULT',
                    },
                  }}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
