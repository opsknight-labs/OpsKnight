'use client';

import { useEffect, useState, useTransition } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { loadIncidentAlertsAction, type IncidentAlertRow } from '../alert-actions';
import ReadablePayloadView from './ReadablePayloadView';

const CHIP = 'inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-2xs font-semibold';

/**
 * Every alert deduplicated into the incident, newest first; each opens to its readable payload (no AI).
 * Loaded when the view is opened, 25 at a time.
 */
export default function IncidentAlertsView({
  incidentId,
  total,
}: {
  incidentId: string;
  total: number;
}) {
  const { userTimeZone } = useTimezone();
  const [alerts, setAlerts] = useState<IncidentAlertRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = (after: string | null) =>
    start(async () => {
      try {
        const page = await loadIncidentAlertsAction(incidentId, after);
        setAlerts(current => (after ? [...current, ...page.alerts] : page.alerts));
        setCursor(page.nextCursor);
        setError(null);
        // The newest alert is the one people usually want first.
        if (!after && page.alerts[0]) setOpen(id => id ?? page.alerts[0].id);
      } catch {
        setError('Could not load the alerts. Try again.');
      } finally {
        setLoaded(true);
      }
    });

  useEffect(() => {
    load(null);
    // Load once per incident.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  if (!loaded)
    return (
      <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading {total} alerts…
      </p>
    );
  if (error && alerts.length === 0)
    return (
      <p role="alert" className="py-6 text-xs text-muted-foreground">
        {error}{' '}
        <button
          type="button"
          onClick={() => load(null)}
          className="font-medium text-primary hover:underline"
        >
          Retry
        </button>
      </p>
    );

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{total}</span> alert
        {total === 1 ? '' : 's'} deduplicated into this incident, newest first. Select one to read
        its payload.
      </p>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
        {alerts.map(alert => {
          const expanded = open === alert.id;
          const firing = /^(triggered|firing|open)$/i.test(alert.status);
          return (
            <li key={alert.id} id={`alert-${alert.id}`} className="scroll-mt-24">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : alert.id)}
                className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/40"
              >
                <span
                  className="shrink-0 whitespace-nowrap font-mono text-2xs tabular-nums text-muted-foreground"
                  suppressHydrationWarning
                >
                  {formatDateTime(alert.createdAt, userTimeZone, { format: 'datetime' })}
                </span>
                <span className={cn(CHIP, toneClasses(firing ? 'critical' : 'ok').soft)}>
                  {firing ? 'Firing' : alert.status.charAt(0) + alert.status.slice(1).toLowerCase()}
                </span>
                {alert.severity && (
                  <span
                    className={cn(
                      CHIP,
                      'border-border bg-background uppercase text-muted-foreground'
                    )}
                  >
                    {alert.severity}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {alert.view.title ?? alert.view.message ?? 'Alert'}
                </span>
                {alert.opener && (
                  <span className="hidden shrink-0 text-2xs text-muted-foreground sm:inline">
                    Opened the incident
                  </span>
                )}
                {alert.view.source && (
                  <span className="hidden shrink-0 text-2xs text-muted-foreground md:inline">
                    {alert.view.source.name}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                    expanded && 'rotate-180'
                  )}
                  aria-hidden
                />
              </button>
              {expanded && (
                <div className="border-t border-border/60 bg-muted/10 px-3 py-3">
                  <ReadablePayloadView view={alert.view} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {cursor && (
        <button
          type="button"
          disabled={pending}
          onClick={() => load(cursor)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-2xs hover:bg-muted/60 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Load older alerts
        </button>
      )}
    </div>
  );
}
