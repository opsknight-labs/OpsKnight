'use client';

import { useActionState, useRef, type ReactNode } from 'react';
import type { NoiseActionState } from '@/app/(app)/settings/intelligence/noise-controls/actions';
import { Button } from '@/components/ui/shadcn/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/shadcn/alert-dialog';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import type { SimulationOutcome } from '@/lib/intelligence/noise-controls/simulation';

export { ActionMessage, fieldClass, labelClass } from '@/components/settings/form-kit';

/** Buttons: 44 px on touch screens. */
export const touchButton = 'h-11 sm:h-10';

export const initialActionState: NoiseActionState = { message: '', ok: false };

export type Option = { id: string; name: string };

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

export interface RowConfirm {
  title: string;
  description: string;
  /** Label of the button that does it; defaults to the row button's own label. */
  confirmLabel?: string;
}

/**
 * Server action button for list rows (end, disable, delete). With `confirm`, the button first asks, in plain
 * words, what will happen; only the dialog's confirm button submits the form.
 */
export function RowAction({
  action,
  fields,
  label,
  accessibleLabel,
  variant = 'outline',
  confirm,
}: {
  action: (state: NoiseActionState, form: FormData) => Promise<NoiseActionState>;
  fields: Record<string, string>;
  label: string;
  accessibleLabel?: string;
  variant?: 'outline' | 'ghost' | 'destructive';
  confirm?: RowConfirm;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const button = (
    <Button
      type={confirm ? 'button' : 'submit'}
      size="sm"
      variant={variant}
      disabled={pending}
      aria-label={accessibleLabel}
      className={touchButton}
    >
      {label}
    </Button>
  );
  return (
    <form ref={formRef} action={formAction} className="inline-flex items-center gap-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {confirm ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className={touchButton}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={touchButton}
                onClick={() => formRef.current?.requestSubmit()}
              >
                {confirm.confirmLabel ?? label}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        button
      )}
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

/** Why a replay changed nothing: its HIGH urgency incidents are exempt unless the policy allows them. */
export function highUrgencyNote(
  outcome: Pick<SimulationOutcome, 'highUrgencyExempt' | 'incidentsEvaluated'>
) {
  if (!outcome.highUrgencyExempt) return null;
  return `${outcome.highUrgencyExempt} of ${outcome.incidentsEvaluated} incidents are HIGH urgency and exempt; enable "Let dedup, flapping and storms touch HIGH urgency" to include them.`;
}

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
      {outcome.guardedCritical > 0 && (
        <p className="text-xs text-muted-foreground" role="note">
          {outcome.guardedCritical} critical or HIGH-urgency incident
          {outcome.guardedCritical === 1 ? '' : 's'} matched but would still page, because this
          control does not cover critical alerts.
        </p>
      )}
      {highUrgencyNote(outcome) && (
        <p className="text-xs text-muted-foreground">{highUrgencyNote(outcome)}</p>
      )}
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

/** The opt-in that lets a window, rule or orchestration rule hide critical and HIGH-urgency alerts. */
export function CoversCriticalField({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-1 sm:col-span-2">
      <label htmlFor={id} className="flex items-start gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={event => onChange(event.target.checked)}
          className="mt-1"
          aria-describedby={`${id}-help`}
        />
        <span>Also hide critical and HIGH-urgency alerts</span>
      </label>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        Off by default: a critical alert always pages. Turn this on only when nobody should be paged
        for anything this matches, even a real outage.
      </p>
    </div>
  );
}
