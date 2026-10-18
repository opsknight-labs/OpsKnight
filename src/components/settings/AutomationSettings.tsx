'use client';
import {
  DEFAULT_AUTOMATION_READINESS_POLICY,
  type AutomationReadinessPolicy,
} from '@/lib/automation/readiness-policy';
import { useState } from 'react';
import { saveAutomationSettings } from '@/app/(app)/settings/system/automation-actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';

type Settings = {
  automationEnabled: boolean;
  automationReadinessPolicy?: AutomationReadinessPolicy;
  automationReadinessPolicyValid?: boolean;
  automationStoreObservationPreviews?: boolean;
  automationTraceRetentionDays: number;
  automationSettingsRevision: number;
};
export default function AutomationSettings({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState({
    ...initialSettings,
    automationReadinessPolicy:
      initialSettings.automationReadinessPolicy ?? DEFAULT_AUTOMATION_READINESS_POLICY,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <section aria-label="Global automation settings" className="space-y-5 rounded-xl border p-5">
      <div>
        <h2 className="text-lg font-semibold">Automation</h2>
        <p className="text-sm text-muted-foreground">
          Manage automation across all services. Changes apply across replicas without a restart.
        </p>
      </div>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={settings.automationEnabled}
          onChange={e => setSettings({ ...settings, automationEnabled: e.target.checked })}
          disabled={busy}
        />{' '}
        Enable service automation globally
      </label>
      <p className="text-sm text-muted-foreground">
        Disabling stops new evaluations. Existing incident decisions stay pinned. Each service
        returns to Disabled. After enabling again, review each service in Shadow before Live.
      </p>
      <div className="space-y-2">
        <Label htmlFor="automation-retention">Trace and observation retention (days)</Label>
        <Input
          id="automation-retention"
          type="number"
          min={1}
          max={3650}
          value={settings.automationTraceRetentionDays}
          disabled={busy}
          onChange={e =>
            setSettings({ ...settings, automationTraceRetentionDays: Number(e.target.value) })
          }
          className="max-w-xs"
        />
        <p className="text-sm text-muted-foreground">
          1–3650 days. Incident routing decisions remain for the incident lifetime. Shortening
          retention removes older diagnostics during the next cleanup.
        </p>
      </div>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={settings.automationStoreObservationPreviews === true}
          disabled={busy}
          onChange={event =>
            setSettings({ ...settings, automationStoreObservationPreviews: event.target.checked })
          }
        />
        Store diagnostic field-value previews
      </label>
      <p className="text-sm text-muted-foreground">
        Off by default. Discovery retains keyed value identities and counts. Enabling stores bounded
        previews for alias authoring; recognizable contact details and credentials are excluded.
        Disabling clears stored previews. Observation retention also applies to previews.
      </p>
      <fieldset className="space-y-3 rounded-lg border p-3" disabled={busy}>
        <legend>Candidate activation readiness policy</legend>
        <p className="text-sm text-muted-foreground">
          Review floors do not prove workload representativeness. Evidence uses daily aggregates;
          pending work must be within policy before activation.
        </p>
        {settings.automationReadinessPolicyValid === false && (
          <p role="alert">
            The stored policy is invalid. Save a reviewed policy before activation.
          </p>
        )}
        {(
          [
            ['minimumEvaluations', 'Minimum candidate evaluations', 1, 1000000, 1],
            ['maximumEvidenceAgeHours', 'Maximum evidence age (hours)', 24, 168, 1],
            ['maximumPendingObservations', 'Maximum pending candidate observations', 0, 1000, 1],
            ['maximumErrorRate', 'Maximum candidate error rate (0–1)', 0, 1, 0.01],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <label key={key} className="block space-y-1">
            <span>{label}</span>
            <Input
              type="number"
              min={min}
              max={max}
              step={step}
              // Keys come exclusively from the literal policy field list above.
              // eslint-disable-next-line security/detect-object-injection
              value={settings.automationReadinessPolicy[key]}
              className="max-w-xs"
              onChange={event =>
                setSettings({
                  ...settings,
                  automationReadinessPolicy: {
                    ...settings.automationReadinessPolicy,
                    [key]: Number(event.target.value),
                  },
                })
              }
            />
          </label>
        ))}
      </fieldset>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            setSettings(
              await saveAutomationSettings({
                automationEnabled: settings.automationEnabled,
                automationTraceRetentionDays: settings.automationTraceRetentionDays,
                automationReadinessPolicy: settings.automationReadinessPolicy,
                automationStoreObservationPreviews:
                  settings.automationStoreObservationPreviews === true,
                expectedRevision: settings.automationSettingsRevision,
              })
            );
            setMessage('Automation settings saved.');
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : 'Could not save automation settings.'
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'Save automation settings'}
      </Button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
