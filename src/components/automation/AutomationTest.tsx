'use client';

import { Button } from '@/components/ui/shadcn/button';

import { ManualSample } from './ManualSample';
import { TraceDetail } from './TraceDetail';

import type { testAutomation } from '@/lib/automation/testing';
import type { Data } from './presentation-types';
const controlClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm max-w-full';
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
  const outcome = result?.result?.outcome;
  const policyName =
    outcome?.type === 'ESCALATION_POLICY'
      ? data.policies.find(policy => policy.id === outcome.policyId)?.name
      : null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sample tests use the production evaluator and create no incidents or notifications.
      </p>
      {data.canReadSensitive === false && (
        <p className="text-sm text-muted-foreground">
          Recent alert samples require sensitive incident access. You can test a sample you provide.
        </p>
      )}
      <label className="block text-sm">
        Use recent alert
        <select
          className={`${controlClass} block w-full`}
          onChange={e => {
            const alert = data.alerts.find(a => a.id === e.target.value);
            if (alert) {
              setProviderSample('{}');
              setSample(
                JSON.stringify(
                  { event_action: 'trigger', dedup_key: 'sample', payload: alert.payload },
                  null,
                  2
                )
              );
            }
          }}
        >
          <option value="">Choose recent alert…</option>
          {data.alerts.map(a => (
            <option key={a.id} value={a.id}>
              {recentAlertLabel(a)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-muted-foreground">
        Recent alerts replay the normalized OpsKnight event only. Provider-specific mappings require
        a raw provider sample in Advanced inputs.
      </p>
      <label className="block text-sm">
        Integration
        <select
          className={`${controlClass} block w-full`}
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
        </select>
      </label>
      <ManualSample onBuild={setSample} />
      <details>
        <summary className="cursor-pointer text-sm font-medium">Advanced sample JSON</summary>
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="text-sm">
            Paste sample event · Normalized event
            <textarea
              className={`${controlClass} w-full min-h-56 font-mono text-xs`}
              value={sample}
              onChange={e => setSample(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Provider input
            <textarea
              className={`${controlClass} w-full min-h-56 font-mono text-xs`}
              value={providerSample}
              onChange={e => setProviderSample(e.target.value)}
            />
          </label>
        </div>
      </details>
      <Button disabled={busy} onClick={() => void runTest()}>
        Test sample
      </Button>
      {result && (
        <div className="space-y-3">
          <p>
            Base classification: {result.classification?.priority ?? 'Unset'} ·{' '}
            {result.classification?.urgency ?? 'Unknown'}
          </p>
          {result.issues.map((i, n) => (
            <p key={n} className="text-sm">
              {i.level}: {i.message}
            </p>
          ))}
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
          <p className="text-sm text-muted-foreground">
            {result.durationMs.toFixed(2)} ms ·{' '}
            {result.goldenResults.filter(f => f.expected === f.actual).length}/
            {result.goldenResults.length} semantic fixtures passed
          </p>
        </div>
      )}
    </div>
  );
}
