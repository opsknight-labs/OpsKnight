'use client';
import { useState } from 'react';
import { saveAutomationSettings } from '@/app/(app)/settings/system/automation-actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';

type Settings = {
  automationEnabled: boolean;
  automationTraceRetentionDays: number;
  automationSettingsRevision: number;
};
export default function AutomationSettings({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
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
