'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FlaskConical, Send } from 'lucide-react';
import { PageHeader } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { InlineNotice } from '@/components/ui/InlineNotice';

export default function SendTestAlertPage() {
  const [integrationKey, setIntegrationKey] = useState('');
  const [dedupKey, setDedupKey] = useState(() => 'test_alert_' + Date.now());
  const [summary, setSummary] = useState('Test Alert from OpsKnight');
  const [severity, setSeverity] = useState<'critical' | 'error' | 'warning' | 'info'>('critical');
  const [eventAction, setEventAction] = useState<'trigger' | 'resolve' | 'acknowledge'>('trigger');
  const [response, setResponse] = useState<{ status: number; data: unknown } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function sendTestAlert() {
    setSubmitted(true);
    if (!integrationKey.trim()) {
      document.getElementById('test-event-key')?.focus();
      return;
    }

    setLoading(true);
    setError('');
    setResponse(null);

    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token token=${integrationKey}`,
        },
        body: JSON.stringify({
          event_action: eventAction,
          dedup_key: dedupKey,
          payload: {
            summary,
            source: 'OpsKnight-test-ui',
            severity,
            custom_details: {
              test: true,
              sent_at: new Date().toISOString(),
            },
          },
        }),
      });

      const data = await res.json();
      setResponse({ status: res.status, data });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const keyError =
    submitted && !integrationKey.trim() ? 'Enter the integration key of the service to test.' : '';
  const ok = response ? response.status < 300 : false;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        title="Send a test event"
        icon={FlaskConical}
        description="Post a simulated alert to the Events API to check a service's routing, deduplication and paging end to end."
        breadcrumbs={[{ label: 'Event Logs', href: '/events' }, { label: 'Send a test event' }]}
      />

      <form
        noValidate
        onSubmit={event => {
          event.preventDefault();
          void sendTestAlert();
        }}
        className="space-y-5 rounded-lg border border-border bg-card p-4 shadow-sm md:p-6"
      >
        <div className="space-y-1.5">
          <Label htmlFor="test-event-key">
            Integration key
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id="test-event-key"
            value={integrationKey}
            onChange={e => setIntegrationKey(e.target.value)}
            placeholder="e.g. 3f9c1d…"
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={Boolean(keyError)}
            aria-describedby={
              keyError ? 'test-event-key-help test-event-key-error' : 'test-event-key-help'
            }
            className="font-mono"
          />
          <p id="test-event-key-help" className="text-xs text-muted-foreground">
            Find it on the service: Services → your service → Integrations.
          </p>
          {keyError && (
            <p
              id="test-event-key-error"
              role="alert"
              className="text-xs font-medium text-destructive"
            >
              {keyError}
            </p>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Event action</legend>
          <div className="flex flex-wrap gap-4">
            {(['trigger', 'acknowledge', 'resolve'] as const).map(action => (
              <label
                key={action}
                className="flex min-h-9 cursor-pointer items-center gap-2 text-sm capitalize"
              >
                <input
                  type="radio"
                  name="test-event-action"
                  value={action}
                  checked={eventAction === action}
                  onChange={() => setEventAction(action)}
                  className="h-4 w-4 accent-primary"
                />
                {action}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="test-event-dedup">Deduplication key</Label>
          <Input
            id="test-event-dedup"
            value={dedupKey}
            onChange={e => setDedupKey(e.target.value)}
            spellCheck={false}
            aria-describedby="test-event-dedup-help"
            className="font-mono"
          />
          <p id="test-event-dedup-help" className="text-xs text-muted-foreground">
            Reuse the same key to acknowledge or resolve the incident this test opens.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="test-event-summary">Alert summary</Label>
          <Input
            id="test-event-summary"
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="High CPU on web-server-01"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="test-event-severity">Severity</Label>
          <Select value={severity} onValueChange={value => setSeverity(value as typeof severity)}>
            <SelectTrigger id="test-event-severity" className="w-full sm:w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button asChild variant="outline">
            <Link href="/events">Cancel</Link>
          </Button>
          <Button type="submit" loading={loading} className="gap-2">
            <Send className="h-4 w-4" aria-hidden="true" />
            Send test event
          </Button>
        </div>

        {error && (
          <InlineNotice tone="error" title="The test event was not sent">
            {error}
          </InlineNotice>
        )}

        {response && (
          <div className="space-y-2" aria-live="polite">
            <p
              className={
                ok
                  ? 'text-sm font-medium text-emerald-700 dark:text-emerald-300'
                  : 'text-sm font-medium text-rose-700 dark:text-rose-300'
              }
            >
              {ok
                ? `Accepted (HTTP ${response.status}). Check Event Logs and the service's incidents.`
                : `Rejected (HTTP ${response.status}). Check the integration key and payload.`}
            </p>
            <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
              {JSON.stringify(response, null, 2)}
            </pre>
          </div>
        )}
      </form>
    </div>
  );
}
