'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { notify } from '@/lib/toast';
import {
  loadSloAlerting,
  saveSloAlertPolicyAction,
  testSloAlertQueriesAction,
  type SloAlertActionState,
  type SloAlertingData,
} from '@/app/(app)/settings/service-objectives/alert-actions';
import { SLO_ALERT_BOUNDS, SLO_BURN_TIERS } from '@/lib/slo/burn-alerts/contract';
import { SloAlertStateBadge } from '@/components/service/intelligence/SloAlertStateBadge';

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-2xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const initial: SloAlertActionState = { ok: false, message: '' };

/**
 * The objective form's "Alerting" step: multi-window burn-rate alerts measured from two metric queries.
 * Loaded on demand (administrators only), saved separately from the definition, off until enabled.
 */
export function SloAlertingStep({ objectiveId }: { objectiveId: string }) {
  const [data, setData] = useState<SloAlertingData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveState, save, saving] = useActionState(saveSloAlertPolicyAction, initial);
  const [testState, test, testing] = useActionState(testSloAlertQueriesAction, initial);
  const prefix = useId();
  const id = (name: string) => `${prefix}-${name}`;

  useEffect(() => {
    let live = true;
    loadSloAlerting(objectiveId)
      .then(result => live && setData(result))
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [objectiveId]);

  useEffect(() => {
    if (saveState.ok && saveState.message) notify.success(saveState.message);
  }, [saveState]);

  if (loadError)
    return <p className="text-xs text-destructive">Alerting settings could not load.</p>;
  if (!data) return <p className="text-xs text-muted-foreground">Loading alerting…</p>;
  if (!data.eligible) return <p className="text-xs text-muted-foreground">{data.reason}</p>;
  const policy = data.policy;
  if (data.connections.length === 0 && !policy)
    return (
      <p className="text-xs text-muted-foreground">
        Burn-rate alerts read good and total event counts from a metrics connection. Add and enable
        one (Prometheus, Grafana, Datadog or CloudWatch) under Intelligence connections first.
      </p>
    );

  const busy = saving || testing;
  return (
    <form action={save} className="space-y-3">
      <input type="hidden" name="objectiveId" value={objectiveId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Pages when the error budget burns at {SLO_BURN_TIERS[0].threshold}× over an hour or{' '}
          {SLO_BURN_TIERS[1].threshold}× over six hours; opens a ticket-urgency incident at{' '}
          {SLO_BURN_TIERS[2].threshold}× over a day or {SLO_BURN_TIERS[3].threshold}× over three
          days. Each needs its short window burning too.
        </p>
        {policy && <SloAlertStateBadge state={policy.state} enabled={policy.enabled} />}
      </div>
      <fieldset disabled={busy} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={id('connection')} className="text-xs font-medium">
            Metrics connection
          </Label>
          <select
            id={id('connection')}
            name="connectionId"
            required
            defaultValue={policy?.connectionId ?? ''}
            className={selectClass}
          >
            <option value="" disabled>
              Choose a connection
            </option>
            {data.connections.map(connection => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('good')} className="text-xs font-medium">
            Good events query
          </Label>
          <Textarea
            id={id('good')}
            name="goodQuery"
            rows={2}
            required
            maxLength={SLO_ALERT_BOUNDS.maxQueryLength}
            defaultValue={policy?.goodQuery}
            className="font-mono text-xs"
            placeholder={'sum(increase(http_requests_total{service="checkout",code!~"5.."}[5m]))'}
            aria-describedby={id('queries-hint')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('total')} className="text-xs font-medium">
            Total events query
          </Label>
          <Textarea
            id={id('total')}
            name="totalQuery"
            rows={2}
            required
            maxLength={SLO_ALERT_BOUNDS.maxQueryLength}
            defaultValue={policy?.totalQuery}
            className="font-mono text-xs"
            placeholder={'sum(increase(http_requests_total{service="checkout"}[5m]))'}
            aria-describedby={id('queries-hint')}
          />
          <p id={id('queries-hint')} className="text-xs text-muted-foreground">
            Each query returns a count of events per 5-minute step, in the connection&apos;s own
            language. Every series a query returns is added up.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm" htmlFor={id('enabled')}>
            <Switch id={id('enabled')} name="enabled" defaultChecked={policy?.enabled ?? false} />
            Enable alerting
          </label>
          <label className="flex items-center gap-2 text-sm" htmlFor={id('tickets')}>
            <Switch
              id={id('tickets')}
              name="ticketsEnabled"
              defaultChecked={policy?.ticketsEnabled ?? true}
            />
            Also open ticket-urgency incidents for slow burns
          </label>
        </div>
      </fieldset>
      {testState.ok && testState.test && (
        <dl
          aria-live="polite"
          className="grid grid-cols-2 gap-2 rounded-md bg-muted px-3 py-2 text-xs sm:grid-cols-4"
        >
          <div>
            <dt className="text-muted-foreground">SLI, last hour</dt>
            <dd className="font-medium tabular-nums">
              {testState.test.sli === null ? 'No events' : `${testState.test.sli}%`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Burn, last hour</dt>
            <dd className="font-medium tabular-nums">
              {testState.test.burn1h === null ? '—' : `${testState.test.burn1h}×`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Good / total</dt>
            <dd className="font-medium tabular-nums">
              {Math.round(testState.test.good)} / {Math.round(testState.test.total)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Steps with data</dt>
            <dd className="font-medium tabular-nums">{testState.test.steps} of 12</dd>
          </div>
        </dl>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="submit" variant="outline" size="sm" formAction={test} loading={testing}>
          Test queries
        </Button>
        <Button type="submit" size="sm" loading={saving}>
          <BellRing className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Save alerting
        </Button>
      </div>
      {[saveState, testState].map(
        (result, index) =>
          result.message &&
          !result.ok && (
            <p key={index} role="alert" className="text-xs font-medium text-destructive">
              {result.message}
            </p>
          )
      )}
      {testState.ok && testState.message && (
        <p className="text-xs text-muted-foreground">{testState.message}</p>
      )}
    </form>
  );
}
