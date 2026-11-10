'use client';

import { useActionState, type ReactNode } from 'react';
import type { NoiseActionState } from '@/app/(app)/settings/intelligence/noise-controls/actions';
import { Button } from '@/components/ui/shadcn/button';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import type { SimulationOutcome } from '@/lib/intelligence/noise-controls/simulation';
import { cn } from '@/lib/utils';

/** Inputs share one look; 44 px tall on touch screens, compact from `sm` up. */
export const fieldClass =
  'min-h-11 w-full rounded-md border border-border bg-background px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 aria-[invalid=true]:border-destructive';
export const labelClass = 'text-sm font-medium';
/** Buttons: 44 px on touch screens. */
export const touchButton = 'h-11 sm:h-9';

export const initialActionState: NoiseActionState = { message: '', ok: false };

export type Option = { id: string; name: string };

/**
 * Success and failure messages from a server action. Success goes into a polite status region that is
 * always mounted (empty, and visually hidden, until there is a message): screen readers do not reliably
 * announce a polite region that is inserted already holding its text. Failures use role="alert", which
 * is announced when it is inserted.
 */
export function ActionMessage({ state }: { state: { message: string; ok: boolean } }) {
  const success = state.ok && state.message ? state.message : '';
  const failure = !state.ok && state.message ? state.message : '';
  return (
    <>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={cn(
          'text-sm text-status-ok-deep dark:text-status-ok-soft',
          !success && 'sr-only'
        )}
      >
        {success}
      </p>
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
    </>
  );
}

export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  );
}

export function useFormatAt() {
  const { userTimeZone } = useTimezone();
  return (value: Date | string | null | undefined) =>
    value ? formatDateTime(value, userTimeZone, { includeTimeZone: true }) : '—';
}

/** `datetime-local` value (browser local time) for a Date. */
export function toLocalInput(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** A Date from a `datetime-local` value (browser local time), or null. */
export function fromLocalInput(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** One-click server action button for list rows (end, disable, delete). */
export function RowAction({
  action,
  fields,
  label,
  accessibleLabel,
  variant = 'outline',
}: {
  action: (state: NoiseActionState, form: FormData) => Promise<NoiseActionState>;
  fields: Record<string, string>;
  label: string;
  accessibleLabel?: string;
  variant?: 'outline' | 'ghost' | 'destructive';
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        size="sm"
        variant={variant}
        disabled={pending}
        aria-label={accessibleLabel}
        className={touchButton}
      >
        {label}
      </Button>
      {state.message && !state.ok && (
        <span role="alert" className="text-xs text-destructive">
          {state.message}
        </span>
      )}
    </form>
  );
}

const ACTION_LABEL = new Map<string, string>([
  ['SUPPRESS', 'suppressed'],
  ['DROP', 'dropped'],
  ['DOWNGRADE', 'downgraded'],
  ['HOLD', 'held'],
  ['APPEND', 'appended'],
  ['GROUP_CHILD', 'grouped'],
  ['TRANSFORM', 'transformed'],
]);

/** The result of a 7-day replay: headline numbers, then up to ten example incidents. */
export function ReplaySummary({
  outcome,
  note,
  incidentHref = (id: string) => `/incidents/${id}`,
}: {
  outcome: SimulationOutcome;
  note?: ReactNode;
  incidentHref?: (id: string) => string;
}) {
  const formatAt = useFormatAt();
  const actions = Object.entries(outcome.byAction);
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
      <p className="font-medium">
        {outcome.incidentsEvaluated === 0
          ? `No incidents opened in the last ${outcome.days} days to replay.`
          : `Over the last ${outcome.days} days, ${outcome.pagesAvoided} of ${outcome.incidentsEvaluated} incidents would not have paged${
              outcome.downgraded
                ? `, ${outcome.downgraded} would have paged at a lower urgency`
                : ''
            }.`}
      </p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {actions.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Replayed decisions">
          {actions.map(([action, count]) => (
            <li key={action} className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {count} {ACTION_LABEL.get(action) ?? action.toLowerCase()}
            </li>
          ))}
        </ul>
      )}
      {outcome.truncated && (
        <p className="text-xs text-muted-foreground">
          Only the most recent {outcome.alertsScanned.toLocaleString('en-US')} alerts were replayed.
        </p>
      )}
      {outcome.examples.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border bg-background">
          {outcome.examples.map(example => (
            <li key={`${example.incidentId}-${example.action}`} className="px-3 py-2 text-xs">
              <a
                className="font-medium underline-offset-2 hover:underline"
                href={incidentHref(example.incidentId)}
              >
                {example.summary || example.incidentId}
              </a>{' '}
              <span className="text-muted-foreground">
                · {ACTION_LABEL.get(example.action) ?? example.action.toLowerCase()} ·{' '}
                {formatAt(example.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
