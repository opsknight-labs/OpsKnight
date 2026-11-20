'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, History, XCircle } from 'lucide-react';
import { automationAction } from '@/app/(app)/services/[id]/automation/actions';
import { Button } from '@/components/ui/shadcn/button';
import type { Snapshot } from '@/lib/automation/contract';
import type { AutomationReplayView } from '@/lib/automation/replay-run';
import { cn } from '@/lib/utils';
import { noticeClasses, toneClasses } from './workspace/status';

const POLL_MS = 1500;

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <dt className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * "Replay against last 7 days": runs the snapshot through the production evaluator over the service's
 * stored incident-opening alerts in a background job and reports what would have changed. Read only:
 * it never publishes, pages or changes an incident.
 */
export function AutomationReplay({
  serviceId,
  snapshot,
  days = 7,
  integrationType,
  className,
}: {
  serviceId: string;
  snapshot: Snapshot;
  days?: number;
  /** Which integration's field mappings apply; the service's first integration when omitted. */
  integrationType?: string;
  className?: string;
}) {
  const headingId = useId();
  const [latest, setLatest] = useState<{ snapshot: Snapshot; view: AutomationReplayView } | null>(
    null
  );
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // An answer about an earlier draft is not an answer about this one.
  const run = latest?.snapshot === snapshot ? latest.view : null;
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const poll = (runId: string) => {
    timer.current = setTimeout(async () => {
      const response = await automationAction({ action: 'replayStatus', serviceId, runId }).catch(
        () => ({ ok: false as const, error: 'Could not check the replay. Try again.' })
      );
      if (!response.ok) {
        // Without a status the run would read as still replaying forever.
        setLatest(null);
        return setError(response.error);
      }
      const view = response.data as AutomationReplayView;
      setLatest(previous => (previous ? { ...previous, view } : previous));
      if (view.status === 'PENDING' || view.status === 'RUNNING') poll(runId);
    }, POLL_MS);
  };

  const start = async () => {
    if (timer.current) clearTimeout(timer.current);
    setStarting(true);
    setError('');
    try {
      const response = await automationAction({
        action: 'replay',
        serviceId,
        snapshot,
        days,
        ...(integrationType ? { integrationType } : {}),
      });
      if (!response.ok) return setError(response.error);
      const view = response.data as AutomationReplayView;
      setLatest({ snapshot, view });
      if (view.status === 'PENDING' || view.status === 'RUNNING') poll(view.runId);
    } finally {
      setStarting(false);
    }
  };

  const running = starting || run?.status === 'PENDING' || run?.status === 'RUNNING';
  const result = run?.status === 'COMPLETED' ? run.result : null;
  const neverMatched =
    result?.rules.filter(rule => rule.matched === 0 && rule.shadowed === 0) ?? [];
  const alwaysShadowed =
    result?.rules.filter(rule => rule.matched === 0 && rule.shadowed > 0) ?? [];
  const unmapped = result ? Object.keys(result.unmappedFields).length : 0;

  return (
    <section
      aria-labelledby={headingId}
      className={cn('space-y-2 rounded-lg border p-3', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="flex items-center gap-2 font-semibold">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Replay against last {days} days
        </h3>
        <Button
          variant="outline"
          className="h-11 sm:h-10"
          disabled={running}
          onClick={() => void start()}
        >
          {running ? 'Replaying…' : result ? 'Replay again' : 'Replay'}
        </Button>
      </div>
      {!run && !error && (
        <p className="text-muted-foreground">
          See what this version would have done with the alerts that opened incidents on this
          service. Nothing is paged or changed.
        </p>
      )}
      {running && (
        <div
          role="progressbar"
          aria-label="Replay progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((run?.progress ?? 0) * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-[width] motion-reduce:transition-none"
            style={{ width: `${Math.max(4, Math.round((run?.progress ?? 0) * 100))}%` }}
          />
        </div>
      )}
      {(error || run?.status === 'FAILED') && (
        <p role="alert" className={cn('flex gap-2', toneClasses.error)}>
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error || run?.error}
        </p>
      )}
      {result && (
        <div className="space-y-2" aria-live="polite">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Alerts replayed" value={result.eventsEvaluated} />
            <Stat label="Route changes" value={result.routeChanged} />
            <Stat label="Priority changes" value={result.priorityChanged} />
            <Stat label="Errors" value={result.fallbacks} />
          </dl>
          {result.eventsEvaluated === 0 ? (
            <p className="text-muted-foreground">
              No incidents opened on this service in the last {days} days, so there is nothing to
              compare.
            </p>
          ) : (
            <p className="text-muted-foreground">
              {result.same} unchanged · {result.defaultRouted} would use the service default ·{' '}
              {result.noEscalationChanged} would change whether anyone is paged · evaluation p99{' '}
              {result.evaluationMs.p99} ms
            </p>
          )}
          {result.truncated && (
            <p className={cn('flex gap-2', toneClasses.warn)}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Only the first {result.alertsScanned.toLocaleString()} alerts were replayed.
            </p>
          )}
          {result.eventsEvaluated > 0 &&
            (neverMatched.length > 0 || alwaysShadowed.length > 0 || unmapped > 0) && (
              <ul className={cn('space-y-1 rounded-md border p-3', noticeClasses.warn)}>
                {neverMatched.length > 0 && (
                  <li>Never matched: {neverMatched.map(rule => rule.name).join(', ')}</li>
                )}
                {alwaysShadowed.length > 0 && (
                  <li>
                    Always decided by an earlier rule:{' '}
                    {alwaysShadowed.map(rule => rule.name).join(', ')}
                  </li>
                )}
                {unmapped > 0 && (
                  <li>
                    {result.unmappedEvents} alerts had {unmapped}{' '}
                    {unmapped === 1 ? 'field' : 'fields'} that could not be read.
                  </li>
                )}
              </ul>
            )}
        </div>
      )}
    </section>
  );
}
