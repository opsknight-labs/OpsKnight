'use client';

import { useId, useState } from 'react';
import { ChevronDown, Play } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
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
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-labelledby={`${id}-input`} className="min-w-0 space-y-4">
        <div>
          <h3 id={`${id}-input`} className="font-semibold tracking-tight">
            Sample event
          </h3>
          <p className="text-sm text-muted-foreground">
            Sample tests use the production evaluator and create no incidents or notifications.
          </p>
        </div>
        {data.canReadSensitive === false && (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            Recent alert samples require sensitive incident access. You can test a sample you
            provide.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-alert`}>Use recent alert</Label>
            <NativeSelect
              id={`${id}-alert`}
              disabled={!data.alerts.length}
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
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-integration`}>Integration</Label>
            <NativeSelect
              id={`${id}-integration`}
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
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs">
            <span className="font-medium text-foreground">
              Replay mode: Normalized alert only (raw provider payload unavailable)
            </span>
          </div>
        )}
        <Hint>
          Recent alerts replay the normalized OpsKnight event. If rules require provider-specific
          mappings, paste a raw provider sample under Advanced sample JSON.
        </Hint>
        <ManualSample onBuild={setSample} />
        <details className="group rounded-lg border border-border/70 bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            Advanced sample JSON
            <ChevronDown
              className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="grid gap-3 border-t border-border/70 p-3 xl:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${id}-event`}>Paste sample event · Normalized event</Label>
              <textarea
                id={`${id}-event`}
                spellCheck={false}
                className={cn(textareaClass, 'min-h-56')}
                value={sample}
                onChange={e => setSample(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${id}-provider`}>Provider input</Label>
              <textarea
                id={`${id}-provider`}
                spellCheck={false}
                className={cn(textareaClass, 'min-h-56')}
                value={providerSample}
                onChange={e => setProviderSample(e.target.value)}
              />
            </div>
          </div>
        </details>
        <Button disabled={busy} onClick={() => void runTest()}>
          <Play aria-hidden="true" />
          Test sample
        </Button>
      </section>
      <section
        aria-labelledby={`${id}-result`}
        aria-busy={busy}
        className="min-w-0 space-y-3 rounded-lg border bg-card p-4"
      >
        <h3 id={`${id}-result`} className="font-semibold tracking-tight">
          Result
        </h3>
        {!result ? (
          <p className="text-sm text-muted-foreground">
            Run a sample to see the matched rule, final priority and route, and why each rule did or
            did not match.
          </p>
        ) : (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              {result.durationMs.toFixed(2)} ms ·{' '}
              {result.goldenResults.filter(f => f.expected === f.actual).length}/
              {result.goldenResults.length} semantic fixtures passed
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-border/70 px-3 py-2">
                <dt className="text-xs text-muted-foreground">Base classification</dt>
                <dd className="text-sm font-medium">
                  {result.classification?.priority ?? 'Unset'} ·{' '}
                  {result.classification?.urgency ?? 'Unknown'}
                </dd>
              </div>
              <div className="rounded-md border border-border/70 px-3 py-2">
                <dt className="text-xs text-muted-foreground">Draft checks</dt>
                <dd className="text-sm font-medium">
                  {result.issues.length === 0
                    ? 'No issues'
                    : `${errors} ${errors === 1 ? 'error' : 'errors'} · ${result.issues.length - errors} ${result.issues.length - errors === 1 ? 'warning' : 'warnings'}`}
                </dd>
              </div>
            </dl>
            {result.providerFieldsMissing && result.providerFieldsMissing.length > 0 && (
              <div
                role="alert"
                className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <p className="font-semibold">Provider-only mapping unavailable</p>
                <p className="mt-0.5">
                  {result.providerFieldsMissing.join(', ')} cannot be extracted because no raw
                  provider sample was supplied. Enter a provider sample in Advanced sample JSON to
                  test provider mappings.
                </p>
              </div>
            )}
            {result.issues.length > 0 && (
              <ul aria-label="Draft issues" className="space-y-1.5">
                {result.issues.map((i, n) => (
                  <li
                    key={n}
                    className={cn(
                      'rounded-md border px-3 py-2 text-sm',
                      i.level === 'ERROR'
                        ? 'border-destructive/40 bg-destructive/5 text-destructive'
                        : 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                    )}
                  >
                    {i.level}: {i.message}
                  </li>
                ))}
              </ul>
            )}
            {result.result && (
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
            )}
          </>
        )}
      </section>
    </div>
  );
}
