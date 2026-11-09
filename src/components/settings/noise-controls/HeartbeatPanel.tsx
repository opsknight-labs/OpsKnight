'use client';

import { useActionState, useId, useState } from 'react';
import {
  createHeartbeatAction,
  deleteHeartbeatAction,
  toggleHeartbeatAction,
} from '@/app/(app)/settings/intelligence/noise-controls/actions';
import EmptyState from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  ActionMessage,
  fieldClass,
  initialActionState,
  labelClass,
  RowAction,
  touchButton,
  useFormatAt,
  type Option,
} from './shared';

export interface HeartbeatRow {
  id: string;
  name: string;
  serviceName: string;
  tokenPrefix: string;
  intervalSeconds: number;
  graceSeconds: number;
  urgency: string;
  enabled: boolean;
  state: string;
  lastPingAt: Date | null;
  dueAt: Date;
  lastIncidentId?: string | null;
}

const STATE_BADGE: Record<
  string,
  { variant: 'success' | 'warning' | 'danger' | 'outline' | 'secondary'; label: string }
> = {
  HEALTHY: { variant: 'success', label: 'Healthy' },
  LATE: { variant: 'warning', label: 'Late' },
  MISSING: { variant: 'danger', label: 'Missing' },
  PENDING: { variant: 'secondary', label: 'Waiting for first ping' },
  PAUSED: { variant: 'outline', label: 'Paused' },
};

export function formatInterval(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          readOnly
          value={value}
          onFocus={event => event.currentTarget.select()}
          className={`${fieldClass} font-mono text-xs`}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={touchButton}
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied('copied');
            } catch {
              setCopied('failed');
            }
          }}
        >
          {copied === 'copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p aria-live="polite" className="sr-only">
        {copied === 'copied'
          ? `${label} copied`
          : copied === 'failed'
            ? 'Copy failed; select the text and copy it manually'
            : ''}
      </p>
    </div>
  );
}

/**
 * Heartbeat monitors: create one (the ping URL and token are shown once, with copy buttons), then watch
 * each monitor's status, last ping and next due time. Writes go through the existing server actions.
 */
export default function HeartbeatPanel({
  monitors,
  services,
  canManage,
  appUrl,
}: {
  monitors: HeartbeatRow[];
  services: Option[];
  canManage: boolean;
  /** Public base URL used in the ping URL (from system settings). */
  appUrl: string;
}) {
  const id = useId();
  const formatAt = useFormatAt();
  const [state, action, pending] = useActionState(createHeartbeatAction, initialActionState);
  // The token only exists after the action returns on the client, so reading `window` here is safe.
  const base = (appUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(
    /\/+$/,
    ''
  );
  const pingUrl = state.token ? `${base}/api/heartbeats/${state.token}` : '';

  return (
    <div className="space-y-5 py-4">
      {canManage && (
        <form
          action={action}
          aria-label="New heartbeat monitor"
          className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-5 sm:p-4"
        >
          <h3 className="text-sm font-semibold sm:col-span-5">New heartbeat monitor</h3>
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor={`${id}-name`} className={labelClass}>
              Name
            </label>
            <input
              id={`${id}-name`}
              name="name"
              required
              maxLength={120}
              className={fieldClass}
              placeholder="Nightly backup"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-service`} className={labelClass}>
              Service
            </label>
            <select
              id={`${id}-service`}
              name="serviceId"
              required
              className={fieldClass}
              defaultValue=""
            >
              <option value="" disabled>
                Select a service
              </option>
              {services.map(service => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-int`} className={labelClass}>
              Expected every (seconds)
            </label>
            <input
              id={`${id}-int`}
              name="intervalSeconds"
              type="number"
              min={10}
              max={604800}
              defaultValue={300}
              className={fieldClass}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-grace`} className={labelClass}>
              Grace (seconds)
            </label>
            <input
              id={`${id}-grace`}
              name="graceSeconds"
              type="number"
              min={0}
              max={86400}
              defaultValue={60}
              className={fieldClass}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-urg`} className={labelClass}>
              Urgency when missing
            </label>
            <select id={`${id}-urg`} name="urgency" className={fieldClass} defaultValue="MEDIUM">
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-5">
            <Button type="submit" disabled={pending} className={touchButton}>
              {pending ? 'Creating…' : 'Create monitor'}
            </Button>
            <ActionMessage state={state} />
          </div>
          {state.token && (
            <div
              className="space-y-3 rounded-md border border-status-elevated/40 bg-status-elevated-soft p-3 text-sm text-foreground dark:bg-status-elevated/10 sm:col-span-5"
              data-testid="heartbeat-token"
            >
              <p className="font-medium">
                Copy these now: the token is shown once and only its hash is stored.
              </p>
              <CopyField label="Ping URL" value={pingUrl} />
              <CopyField label="Token" value={state.token} />
              <CopyField
                label="Example cron command"
                value={`curl -fsS -m 10 --retry 3 ${pingUrl}`}
              />
            </div>
          )}
        </form>
      )}

      {monitors.length === 0 ? (
        <EmptyState
          size="sm"
          title="No heartbeat monitors"
          description={
            canManage
              ? 'Create one above and call its ping URL at the end of each job run.'
              : 'Ask an intelligence manager to add heartbeat monitors for your scheduled jobs.'
          }
        />
      ) : (
        <ul className="divide-y divide-border" aria-label="Heartbeat monitors">
          {monitors.map(monitor => {
            const badge = STATE_BADGE[monitor.state] ?? {
              variant: 'secondary' as const,
              label: monitor.state,
            };
            return (
              <li
                key={monitor.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    {monitor.name} <Badge variant={badge.variant}>{badge.label}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {monitor.serviceName} · every {formatInterval(monitor.intervalSeconds)} (+
                    {formatInterval(monitor.graceSeconds)} grace) · {monitor.urgency} when missing ·
                    token <code>{monitor.tokenPrefix}…</code>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last ping {monitor.lastPingAt ? formatAt(monitor.lastPingAt) : 'never'}
                    {monitor.enabled ? ` · next due ${formatAt(monitor.dueAt)}` : ''}
                    {monitor.lastIncidentId && (
                      <>
                        {' '}
                        ·{' '}
                        <a
                          className="underline underline-offset-2"
                          href={`/incidents/${monitor.lastIncidentId}`}
                        >
                          last incident
                        </a>
                      </>
                    )}
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <RowAction
                      action={toggleHeartbeatAction}
                      fields={{ id: monitor.id, enabled: monitor.enabled ? 'false' : 'true' }}
                      label={monitor.enabled ? 'Pause' : 'Resume'}
                      accessibleLabel={`${monitor.enabled ? 'Pause' : 'Resume'} ${monitor.name}`}
                    />
                    <RowAction
                      action={deleteHeartbeatAction}
                      fields={{ id: monitor.id }}
                      label="Delete"
                      accessibleLabel={`Delete ${monitor.name}`}
                      variant="ghost"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
