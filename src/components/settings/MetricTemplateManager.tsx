'use client';

import { useActionState, useId } from 'react';
import {
  deleteMetricTemplateAction,
  evaluateMetricTemplateAction,
  saveMetricTemplateAction,
  type MetricTemplateActionState,
} from '@/app/(app)/settings/intelligence/response/metrics/actions';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  describeMetricStatus,
  METRIC_TEMPLATE_BOUNDS,
  type MetricTemplateView,
} from '@/lib/intelligence/metric-anomaly/contract';

const initial: MetricTemplateActionState = { message: '', ok: false };
const fieldClass = 'w-full rounded-md border border-border bg-background p-2 text-sm';

type Option = { id: string; name: string };

function Status({ state }: { state: MetricTemplateActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={state.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}
    >
      {state.message}
    </p>
  );
}

function NumberField({
  id,
  name,
  label,
  bounds,
  value,
  step,
}: {
  id: string;
  name: string;
  label: string;
  bounds: { min: number; max: number; default: number };
  value?: number;
  step?: number;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={`${id}-${name}`}
        name={name}
        type="number"
        min={bounds.min}
        max={bounds.max}
        step={step ?? 1}
        defaultValue={value ?? bounds.default}
        className={fieldClass}
      />
    </div>
  );
}

/** Add form when `template` is absent, edit form otherwise. */
export function MetricTemplateForm({
  services,
  connections,
  template,
}: {
  services: Option[];
  connections: Option[];
  template?: MetricTemplateView;
}) {
  const [state, action, pending] = useActionState(saveMetricTemplateAction, initial);
  const id = useId();
  const bounds = METRIC_TEMPLATE_BOUNDS;
  if (connections.length === 0 && !template)
    return (
      <p className="py-3 text-sm text-muted-foreground">
        Add and enable a metrics connection (Prometheus, Grafana, Datadog or CloudWatch) under
        Intelligence connections first.
      </p>
    );
  return (
    <form action={action} className="space-y-3 py-4">
      {template && <input type="hidden" name="id" value={template.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-service`} className="text-sm font-medium">
            Service
          </label>
          <select
            id={`${id}-service`}
            name="serviceId"
            required
            defaultValue={template?.serviceId ?? ''}
            className={fieldClass}
          >
            <option value="" disabled>
              Choose a service
            </option>
            {services.map(service => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-connection`} className="text-sm font-medium">
            Connection
          </label>
          <select
            id={`${id}-connection`}
            name="connectionId"
            required
            defaultValue={template?.connectionId ?? ''}
            className={fieldClass}
          >
            <option value="" disabled>
              Choose a connection
            </option>
            {connections.map(connection => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Name
          </label>
          <input
            id={`${id}-name`}
            name="name"
            required
            maxLength={80}
            defaultValue={template?.name}
            placeholder="p99 latency"
            className={fieldClass}
          />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-query`} className="text-sm font-medium">
          Query
        </label>
        <textarea
          id={`${id}-query`}
          name="query"
          rows={2}
          required
          maxLength={bounds.queryLength}
          defaultValue={template?.query}
          className={`${fieldClass} font-mono text-xs`}
          placeholder={
            'histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{service="checkout"}[5m])))'
          }
        />
        <p className="text-xs text-muted-foreground">
          In the connection&apos;s own language (PromQL, a Datadog metric query, a CloudWatch
          Metrics Insights expression). Prefer a query that returns one series.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <label htmlFor={`${id}-direction`} className="text-sm font-medium">
            Counts when it
          </label>
          <select
            id={`${id}-direction`}
            name="direction"
            defaultValue={template?.direction ?? 'BOTH'}
            className={fieldClass}
          >
            <option value="BOTH">Rises or drops</option>
            <option value="UP">Rises</option>
            <option value="DOWN">Drops</option>
          </select>
        </div>
        <NumberField
          id={id}
          name="thresholdMad"
          label="Threshold (MAD)"
          bounds={bounds.thresholdMad}
          value={template?.thresholdMad}
          step={0.5}
        />
        <NumberField
          id={id}
          name="baselineWeeks"
          label="Baseline weeks"
          bounds={bounds.baselineWeeks}
          value={template?.baselineWeeks}
        />
        <div className="space-y-1">
          <label htmlFor={`${id}-minDeviation`} className="text-sm font-medium">
            Ignore changes below
          </label>
          <input
            id={`${id}-minDeviation`}
            name="minDeviation"
            type="number"
            min={0}
            step="any"
            defaultValue={template?.minDeviation ?? 0}
            className={fieldClass}
          />
        </div>
        <NumberField
          id={id}
          name="windowMinutes"
          label="Window (min)"
          bounds={bounds.windowMinutes}
          value={template?.windowMinutes}
        />
        <NumberField
          id={id}
          name="stepSeconds"
          label="Step (s)"
          bounds={bounds.stepSeconds}
          value={template?.stepSeconds}
        />
        <NumberField
          id={id}
          name="intervalMinutes"
          label="Every (min)"
          bounds={bounds.intervalMinutes}
          value={template?.intervalMinutes}
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
          <input type="checkbox" name="enabled" defaultChecked={template?.enabled ?? false} />
          Enabled
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : template ? 'Save template' : 'Add template'}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

function TemplateActions({ id, enabled }: { id: string; enabled: boolean }) {
  const [runState, run, running] = useActionState(evaluateMetricTemplateAction, initial);
  const [removeState, remove, removing] = useActionState(deleteMetricTemplateAction, initial);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {enabled && (
        <form action={run}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" variant="outline" disabled={running}>
            {running ? 'Queuing…' : 'Evaluate now'}
          </Button>
        </form>
      )}
      <form action={remove}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" size="sm" variant="ghost" disabled={removing}>
          Remove
        </Button>
      </form>
      <Status state={runState.message ? runState : removeState} />
    </div>
  );
}

export function MetricTemplateList({
  templates,
  services,
  connections,
  canManage,
}: {
  templates: MetricTemplateView[];
  services: Option[];
  connections: Option[];
  canManage: boolean;
}) {
  if (templates.length === 0)
    return <p className="py-2 text-sm text-muted-foreground">No metric templates yet.</p>;
  return (
    <ul className="divide-y divide-border" aria-label="Metric templates">
      {templates.map(template => (
        <li key={template.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">
                {template.serviceName} · {template.name}
                <Badge variant={template.enabled ? 'secondary' : 'outline'} className="ml-2">
                  {template.enabled ? 'On' : 'Off'}
                </Badge>
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground">{template.query}</p>
              <p className="text-xs text-muted-foreground">
                {template.connectionName ?? 'No connection'} · {template.thresholdMad} MAD over{' '}
                {template.baselineWeeks} weeks · every {template.intervalMinutes} min ·{' '}
                {template.lastEvaluatedAt
                  ? `last run ${template.lastEvaluatedAt.slice(0, 16).replace('T', ' ')} UTC · ${describeMetricStatus(template.lastStatus)}`
                  : 'not evaluated yet'}
              </p>
            </div>
            {canManage && <TemplateActions id={template.id} enabled={template.enabled} />}
          </div>
          {canManage && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">Edit</summary>
              <MetricTemplateForm
                services={services}
                connections={connections}
                template={template}
              />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
