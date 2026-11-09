'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import {
  createWindowAction,
  endWindowAction,
  toggleWindowAction,
} from '@/app/(app)/settings/intelligence/noise-controls/actions';
import { previewWindowAction } from '@/app/(app)/settings/intelligence/noise-controls/preview-actions';
import EmptyState from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  buildMaintenanceAgenda,
  describeRecurrence,
  presetForRecurrence,
  RECURRENCE_PRESETS,
  recurrenceForPreset,
  upcomingOccurrences,
  type RecurrencePreset,
} from '@/lib/intelligence/noise-controls/builders';
import type { MaintenanceWindowView } from '@/lib/intelligence/noise-controls/manage';
import type { WindowPreview } from '@/lib/intelligence/noise-controls/preview';
import {
  ActionMessage,
  FieldError,
  fieldClass,
  fromLocalInput,
  initialActionState,
  labelClass,
  ReplaySummary,
  RowAction,
  toLocalInput,
  touchButton,
  useFormatAt,
  type Option,
} from './shared';

type Scope = 'SERVICE' | 'TEAM' | 'LABEL' | 'ALL';
type Effect = 'SUPPRESS' | 'DOWNGRADE';

export interface WindowDraft {
  name: string;
  description: string;
  scope: Scope;
  serviceId: string;
  teamId: string;
  labelKey: string;
  labelValue: string;
  effect: Effect;
  downgradeUrgency: 'LOW' | 'MEDIUM';
  startsAt: string;
  endsAt: string;
  preset: RecurrencePreset;
  customRule: string;
}

type DraftErrors = Partial<Record<keyof WindowDraft | 'form', string>>;

/**
 * Times start empty so the server and the browser render the same thing (the browser's time zone is
 * only known on the client); picking a start fills a two-hour end.
 */
export function emptyWindowDraft(): WindowDraft {
  return {
    name: '',
    description: '',
    scope: 'SERVICE',
    serviceId: '',
    teamId: '',
    labelKey: '',
    labelValue: '',
    effect: 'SUPPRESS',
    downgradeUrgency: 'LOW',
    startsAt: '',
    endsAt: '',
    preset: 'none',
    customRule: '',
  };
}

export function draftFromWindow(window: MaintenanceWindowView): WindowDraft {
  const preset = presetForRecurrence(window.recurrence, window.startsAt);
  return {
    name: window.name,
    description: window.description ?? '',
    scope: window.scope,
    serviceId: window.serviceId ?? '',
    teamId: window.teamId ?? '',
    labelKey: window.labelKey ?? '',
    labelValue: window.labelValue ?? '',
    effect: window.effect,
    downgradeUrgency: window.downgradeUrgency === 'MEDIUM' ? 'MEDIUM' : 'LOW',
    startsAt: toLocalInput(window.startsAt),
    endsAt: toLocalInput(window.endsAt),
    preset,
    customRule: preset === 'custom' ? (window.recurrence ?? '') : '',
  };
}

/** Builder rows → the `maintenanceWindowInputSchema` shape, or the field errors that block it. */
export function windowInputFromDraft(draft: WindowDraft): {
  input: Record<string, unknown> | null;
  errors: DraftErrors;
} {
  const errors: DraftErrors = {};
  if (!draft.name.trim()) errors.name = 'Give the window a name.';
  if (draft.scope === 'SERVICE' && !draft.serviceId) errors.serviceId = 'Pick a service.';
  if (draft.scope === 'TEAM' && !draft.teamId) errors.teamId = 'Pick a team.';
  if (draft.scope === 'LABEL' && (!draft.labelKey.trim() || !draft.labelValue.trim()))
    errors.labelKey = 'Label windows need a key and a value.';
  const startsAt = fromLocalInput(draft.startsAt);
  const endsAt = fromLocalInput(draft.endsAt);
  if (!startsAt) errors.startsAt = 'Enter a start time.';
  if (!endsAt) errors.endsAt = 'Enter an end time.';
  const recurrence = recurrenceForPreset(draft.preset, startsAt, draft.customRule);
  if (draft.preset === 'custom' && !recurrence) errors.customRule = 'Enter an RRULE.';
  if (startsAt && endsAt) {
    const check = upcomingOccurrences(startsAt, endsAt, recurrence, startsAt, 1);
    if (!check.ok) {
      if (/RRULE|FREQ|BYDAY|COUNT|UNTIL|INTERVAL|recurrence/i.test(check.error))
        errors.customRule = check.error;
      else errors.endsAt = check.error;
    }
  }
  if (Object.keys(errors).length || !startsAt || !endsAt) return { input: null, errors };
  return {
    input: {
      name: draft.name.trim(),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      scope: draft.scope,
      ...(draft.scope === 'SERVICE' ? { serviceId: draft.serviceId } : {}),
      ...(draft.scope === 'TEAM' ? { teamId: draft.teamId } : {}),
      ...(draft.scope === 'LABEL'
        ? { labelKey: draft.labelKey.trim(), labelValue: draft.labelValue.trim() }
        : {}),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      recurrence,
      effect: draft.effect,
      ...(draft.effect === 'DOWNGRADE' ? { downgradeUrgency: draft.downgradeUrgency } : {}),
    },
    errors,
  };
}

function toFormData(input: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined && value !== null) form.set(key, String(value));
  return form;
}

export function MaintenanceWindowBuilder({
  services,
  teams,
  editing,
  onDone,
}: {
  services: Option[];
  teams: Option[];
  /** The window being edited: saving creates the updated window and disables this one. */
  editing?: MaintenanceWindowView | null;
  onDone?: () => void;
}) {
  const id = useId();
  const formatAt = useFormatAt();
  const [draft, setDraft] = useState<WindowDraft>(() =>
    editing ? draftFromWindow(editing) : emptyWindowDraft()
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [result, setResult] = useState(initialActionState);
  const [preview, setPreview] = useState<WindowPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [saving, startSave] = useTransition();
  const [previewing, startPreview] = useTransition();
  const nameField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Opening the editor from a list row moves keyboard focus into it.
    if (editing) nameField.current?.focus();
  }, [editing]);

  const set = <K extends keyof WindowDraft>(key: K, value: WindowDraft[K]) => {
    setDraft(current => {
      const next = { ...current, [key]: value };
      if (key === 'startsAt' && !current.endsAt) {
        const start = fromLocalInput(String(value));
        if (start) next.endsAt = toLocalInput(new Date(start.getTime() + 2 * 3_600_000));
      }
      return next;
    });
    setErrors(current => ({ ...current, [key]: undefined }));
    setPreview(null);
  };

  const occurrences = useMemo(() => {
    const startsAt = fromLocalInput(draft.startsAt);
    const endsAt = fromLocalInput(draft.endsAt);
    if (!startsAt || !endsAt) return null;
    const recurrence = recurrenceForPreset(draft.preset, startsAt, draft.customRule);
    if (draft.preset === 'custom' && !recurrence) return null;
    return { recurrence, check: upcomingOccurrences(startsAt, endsAt, recurrence, new Date(), 5) };
  }, [draft.startsAt, draft.endsAt, draft.preset, draft.customRule]);

  const validate = () => {
    const { input, errors: found } = windowInputFromDraft(draft);
    setErrors(found);
    return input;
  };

  const runPreview = () => {
    const input = validate();
    if (!input) return;
    setPreviewError('');
    startPreview(async () => {
      const response = await previewWindowAction(input);
      if (response.ok) setPreview(response.data);
      else setPreviewError(response.message);
    });
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const input = validate();
    if (!input) return;
    startSave(async () => {
      const created = await createWindowAction(initialActionState, toFormData(input));
      if (created.ok && editing) {
        const form = new FormData();
        form.set('id', editing.id);
        form.set('enabled', 'false');
        const disabled = await toggleWindowAction(initialActionState, form);
        setResult(
          disabled.ok
            ? {
                ok: true,
                message: 'Window updated: the new version is saved and the original disabled.',
              }
            : {
                ok: false,
                message: `Saved the new window, but the original could not be disabled: ${disabled.message}`,
              }
        );
      } else setResult(created);
      if (created.ok) {
        setDraft(emptyWindowDraft());
        setPreview(null);
        onDone?.();
      }
    });
  };

  const invalid = (key: keyof DraftErrors) =>
    new Map(Object.entries(errors)).get(key)
      ? { 'aria-invalid': true, 'aria-describedby': `${id}-${key}-error` }
      : {};

  return (
    <form
      onSubmit={save}
      noValidate
      aria-label={editing ? `Edit maintenance window ${editing.name}` : 'New maintenance window'}
      className="space-y-4 rounded-lg border border-border p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {editing ? `Edit “${editing.name}”` : 'Schedule maintenance'}
        </h3>
        {editing && (
          <p className="text-xs text-muted-foreground">
            Saving creates the updated window and disables the original; history is kept.
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${id}-name`} className={labelClass}>
            Name
          </label>
          <input
            id={`${id}-name`}
            ref={nameField}
            value={draft.name}
            maxLength={120}
            onChange={event => set('name', event.target.value)}
            className={fieldClass}
            placeholder="Database upgrade"
            {...invalid('name')}
          />
          <FieldError id={`${id}-name-error`} message={errors.name} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-scope`} className={labelClass}>
            Applies to
          </label>
          <select
            id={`${id}-scope`}
            value={draft.scope}
            onChange={event => set('scope', event.target.value as Scope)}
            className={fieldClass}
          >
            <option value="SERVICE">One service</option>
            <option value="TEAM">A team&apos;s services</option>
            <option value="LABEL">Alerts with a label</option>
            <option value="ALL">Everything</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-effect`} className={labelClass}>
            Effect
          </label>
          <select
            id={`${id}-effect`}
            value={draft.effect}
            onChange={event => set('effect', event.target.value as Effect)}
            className={fieldClass}
          >
            <option value="SUPPRESS">Suppress (never page)</option>
            <option value="DOWNGRADE">Downgrade urgency</option>
          </select>
        </div>
        {draft.scope === 'SERVICE' && (
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor={`${id}-service`} className={labelClass}>
              Service
            </label>
            <select
              id={`${id}-service`}
              value={draft.serviceId}
              onChange={event => set('serviceId', event.target.value)}
              className={fieldClass}
              {...invalid('serviceId')}
            >
              <option value="">Select a service</option>
              {services.map(service => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
            <FieldError id={`${id}-serviceId-error`} message={errors.serviceId} />
          </div>
        )}
        {draft.scope === 'TEAM' && (
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor={`${id}-team`} className={labelClass}>
              Team
            </label>
            <select
              id={`${id}-team`}
              value={draft.teamId}
              onChange={event => set('teamId', event.target.value)}
              className={fieldClass}
              {...invalid('teamId')}
            >
              <option value="">Select a team</option>
              {teams.map(team => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <FieldError id={`${id}-teamId-error`} message={errors.teamId} />
          </div>
        )}
        {draft.scope === 'LABEL' && (
          <>
            <div className="space-y-1">
              <label htmlFor={`${id}-lk`} className={labelClass}>
                Label key
              </label>
              <input
                id={`${id}-lk`}
                value={draft.labelKey}
                onChange={event => set('labelKey', event.target.value)}
                className={fieldClass}
                placeholder="env"
                {...invalid('labelKey')}
              />
              <FieldError id={`${id}-labelKey-error`} message={errors.labelKey} />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-lv`} className={labelClass}>
                Label value
              </label>
              <input
                id={`${id}-lv`}
                value={draft.labelValue}
                onChange={event => set('labelValue', event.target.value)}
                className={fieldClass}
                placeholder="staging"
              />
            </div>
          </>
        )}
        {draft.effect === 'DOWNGRADE' && (
          <div className="space-y-1">
            <label htmlFor={`${id}-du`} className={labelClass}>
              Downgrade to
            </label>
            <select
              id={`${id}-du`}
              value={draft.downgradeUrgency}
              onChange={event => set('downgradeUrgency', event.target.value as 'LOW' | 'MEDIUM')}
              className={fieldClass}
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
            </select>
          </div>
        )}
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-4">
        <legend className="mb-1 text-sm font-medium">When</legend>
        <div className="space-y-1">
          <label htmlFor={`${id}-start`} className={labelClass}>
            Starts (your time)
          </label>
          <input
            id={`${id}-start`}
            type="datetime-local"
            value={draft.startsAt}
            onChange={event => set('startsAt', event.target.value)}
            className={fieldClass}
            {...invalid('startsAt')}
          />
          <FieldError id={`${id}-startsAt-error`} message={errors.startsAt} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-end`} className={labelClass}>
            Ends (your time)
          </label>
          <input
            id={`${id}-end`}
            type="datetime-local"
            value={draft.endsAt}
            onChange={event => set('endsAt', event.target.value)}
            className={fieldClass}
            {...invalid('endsAt')}
          />
          <FieldError id={`${id}-endsAt-error`} message={errors.endsAt} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${id}-repeat`} className={labelClass}>
            Repeats
          </label>
          <select
            id={`${id}-repeat`}
            value={draft.preset}
            onChange={event => set('preset', event.target.value as RecurrencePreset)}
            className={fieldClass}
            aria-describedby={`${id}-repeat-help`}
          >
            {RECURRENCE_PRESETS.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <p id={`${id}-repeat-help`} className="text-xs text-muted-foreground">
            Repeats are evaluated in UTC; each occurrence lasts as long as the first.
          </p>
        </div>
        {draft.preset === 'custom' && (
          <div className="space-y-1 sm:col-span-4">
            <label htmlFor={`${id}-rrule`} className={labelClass}>
              RRULE
            </label>
            <input
              id={`${id}-rrule`}
              value={draft.customRule}
              onChange={event => set('customRule', event.target.value.toUpperCase())}
              className={`${fieldClass} font-mono`}
              placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;COUNT=10"
              {...invalid('customRule')}
            />
            <FieldError id={`${id}-customRule-error`} message={errors.customRule} />
          </div>
        )}
      </fieldset>

      <div aria-live="polite" className="text-sm">
        {occurrences?.check.ok && occurrences.check.occurrences.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              {occurrences.recurrence ? 'Next occurrences' : 'Occurrence'}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs" aria-label="Upcoming occurrences">
              {occurrences.check.occurrences.map(span => (
                <li key={span.startsAt.toISOString()}>
                  {formatAt(span.startsAt)} → {formatAt(span.endsAt)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {occurrences?.check.ok && occurrences.check.occurrences.length === 0 && (
          <p className="text-xs text-muted-foreground">
            This window is entirely in the past; it would never match.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving} className={touchButton}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add window'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={runPreview}
          disabled={previewing}
          className={touchButton}
        >
          {previewing ? 'Replaying…' : 'Test against the last 7 days'}
        </Button>
        {editing && onDone && (
          <Button type="button" variant="ghost" onClick={onDone} className={touchButton}>
            Cancel
          </Button>
        )}
      </div>
      <ActionMessage state={result} />
      <div aria-live="polite" aria-busy={previewing}>
        {previewError && (
          <p role="alert" className="text-sm text-destructive">
            {previewError}
          </p>
        )}
        {preview && (
          <ReplaySummary
            outcome={preview.outcome}
            note={
              preview.shiftedWeeks > 0
                ? `This window is in the future, so it was replayed at the same weekday and time ${preview.shiftedWeeks} week${preview.shiftedWeeks === 1 ? '' : 's'} earlier. Only this window was applied; other controls were off.`
                : 'Only this window was applied; other controls were off.'
            }
          />
        )}
      </div>
    </form>
  );
}

function scopeText(window: MaintenanceWindowView, teams: Option[]): string {
  switch (window.scope) {
    case 'SERVICE':
      return window.serviceName ?? 'One service';
    case 'TEAM':
      return `Team ${teams.find(team => team.id === window.teamId)?.name ?? window.teamId ?? ''}`;
    case 'LABEL':
      return `Label ${window.labelKey}=${window.labelValue}`;
    default:
      return 'All services';
  }
}

/**
 * Maintenance windows as an agenda (the next 14 days, recurring occurrences expanded) plus the list of
 * windows with edit, end-now and enable/disable. Writes go through the existing server actions only.
 */
export default function MaintenanceWindowsPanel({
  windows,
  services,
  teams,
  canManage,
  now,
}: {
  windows: MaintenanceWindowView[];
  services: Option[];
  teams: Option[];
  canManage: boolean;
  /** Server render time, so the agenda is the same on the server and on hydration. */
  now: Date;
}) {
  const formatAt = useFormatAt();
  const [editing, setEditing] = useState<MaintenanceWindowView | null>(null);
  const agenda = useMemo(() => buildMaintenanceAgenda(windows, now, 14), [windows, now]);
  const byId = useMemo(() => new Map(windows.map(window => [window.id, window])), [windows]);

  return (
    <div className="space-y-5 py-4">
      {canManage && (
        <MaintenanceWindowBuilder
          key={editing?.id ?? 'new'}
          services={services}
          teams={teams}
          editing={editing}
          onDone={editing ? () => setEditing(null) : undefined}
        />
      )}

      <section aria-labelledby="maintenance-agenda-heading" className="space-y-2">
        <h3 id="maintenance-agenda-heading" className="text-sm font-semibold">
          Next 14 days
        </h3>
        {agenda.length === 0 ? (
          <EmptyState
            size="sm"
            title="No maintenance scheduled"
            description={
              canManage
                ? 'Schedule a window above; recurring windows show every occurrence here.'
                : 'Ask an intelligence manager to schedule maintenance windows.'
            }
          />
        ) : (
          <ol className="space-y-3" aria-label="Maintenance agenda">
            {agenda.map(day => (
              <li key={day.date}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <time dateTime={day.date}>
                    {new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </time>
                </h4>
                <ul className="mt-1 divide-y divide-border rounded-md border border-border">
                  {day.entries.map(entry => (
                    <li
                      key={`${entry.windowId}-${entry.startsAt.toISOString()}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {entry.name}{' '}
                          {entry.active && <Badge variant="warning">In progress</Badge>}{' '}
                          {entry.recurring && <Badge variant="outline">Repeats</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatAt(entry.startsAt)} → {formatAt(entry.endsAt)} ·{' '}
                          {entry.effect === 'SUPPRESS' ? 'suppress' : 'downgrade'}
                        </p>
                      </div>
                      {canManage && entry.active && (
                        <RowAction
                          action={endWindowAction}
                          fields={{ id: entry.windowId }}
                          label="End now"
                          accessibleLabel={`End ${entry.name} now`}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="maintenance-all-heading" className="space-y-2">
        <h3 id="maintenance-all-heading" className="text-sm font-semibold">
          All windows
        </h3>
        {windows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No maintenance windows.</p>
        ) : (
          <ul className="divide-y divide-border">
            {windows.map(window => (
              <li
                key={window.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    {window.name} {window.active && <Badge variant="warning">Active now</Badge>}{' '}
                    {window.endedAt && <Badge variant="secondary">Ended early</Badge>}{' '}
                    {!window.enabled && <Badge variant="outline">Disabled</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {scopeText(window, teams)} ·{' '}
                    {window.effect === 'SUPPRESS'
                      ? 'suppress'
                      : `downgrade to ${window.downgradeUrgency}`}{' '}
                    · {describeRecurrence(window.recurrence)} ·{' '}
                    {window.recurrence
                      ? `next ${formatAt(window.nextSpan?.startsAt)}`
                      : `${formatAt(window.startsAt)} → ${formatAt(window.endsAt)}`}
                  </p>
                </div>
                {canManage && !window.endedAt && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={touchButton}
                      aria-label={`Edit ${window.name}`}
                      onClick={() => setEditing(byId.get(window.id) ?? null)}
                    >
                      Edit
                    </Button>
                    {window.active && (
                      <RowAction
                        action={endWindowAction}
                        fields={{ id: window.id }}
                        label="End now"
                        accessibleLabel={`End ${window.name} now`}
                      />
                    )}
                    <RowAction
                      action={toggleWindowAction}
                      fields={{ id: window.id, enabled: window.enabled ? 'false' : 'true' }}
                      label={window.enabled ? 'Disable' : 'Enable'}
                      accessibleLabel={`${window.enabled ? 'Disable' : 'Enable'} ${window.name}`}
                      variant="ghost"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
