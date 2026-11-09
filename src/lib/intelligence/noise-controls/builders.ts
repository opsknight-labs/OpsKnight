import {
  MATCHER_FIELDS,
  matcherSchema,
  orchestrationRuleSchema,
  PREPAGING_LIMITS,
  type Matcher,
  type OrchestrationRule,
} from './contract';
import { parseRecurrence, windowSpans } from './recurrence';

/**
 * Pure helpers behind the noise-control builders (maintenance calendar, suppression and orchestration
 * rule builders). No database, no network: client components import them, and the server previews reuse
 * them so the two never disagree. Recurrence is evaluated in UTC, like the hook.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export const RECURRENCE_PRESETS = [
  { id: 'none', label: 'Does not repeat' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekly', label: 'Every week on the start day' },
  { id: 'weekdays', label: 'Every weekday (Mon–Fri)' },
  { id: 'weekends', label: 'Every weekend (Sat, Sun)' },
  { id: 'monthly', label: 'Every month on the start date' },
  { id: 'custom', label: 'Custom RRULE' },
] as const;
export type RecurrencePreset = (typeof RECURRENCE_PRESETS)[number]['id'];

/** The RRULE a preset stands for, anchored on the window's (UTC) start. `custom` returns `custom`. */
export function recurrenceForPreset(
  preset: RecurrencePreset,
  startsAt: Date | null,
  custom = ''
): string | null {
  switch (preset) {
    case 'none':
      return null;
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly':
      return startsAt ? `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[startsAt.getUTCDay()]}` : 'FREQ=WEEKLY';
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekends':
      return 'FREQ=WEEKLY;BYDAY=SA,SU';
    case 'monthly':
      return 'FREQ=MONTHLY';
    case 'custom':
      return custom.trim() || null;
    default:
      return null;
  }
}

/** The preset an existing RRULE corresponds to, so an edited window opens on the right choice. */
export function presetForRecurrence(
  recurrence: string | null,
  startsAt: Date | null
): RecurrencePreset {
  if (!recurrence) return 'none';
  for (const preset of RECURRENCE_PRESETS) {
    if (preset.id === 'custom' || preset.id === 'none') continue;
    if (recurrenceForPreset(preset.id, startsAt) === recurrence) return preset.id;
  }
  return 'custom';
}

/** A human description of a recurrence, falling back to the raw rule. */
export function describeRecurrence(recurrence: string | null): string {
  if (!recurrence) return 'Once';
  switch (recurrence) {
    case 'FREQ=DAILY':
      return 'Every day';
    case 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR':
      return 'Every weekday';
    case 'FREQ=WEEKLY;BYDAY=SA,SU':
      return 'Every weekend';
    case 'FREQ=MONTHLY':
      return 'Every month';
    default: {
      const weekly = /^FREQ=WEEKLY;BYDAY=([A-Z]{2})$/.exec(recurrence);
      if (weekly) return `Every week (${weekly[1]})`;
      return recurrence;
    }
  }
}

export type OccurrenceCheck =
  { ok: true; occurrences: Array<{ startsAt: Date; endsAt: Date }> } | { ok: false; error: string };

/** The next `count` occurrences of a window from `now` (a current one included), or why it is invalid. */
export function upcomingOccurrences(
  startsAt: Date,
  endsAt: Date,
  recurrence: string | null,
  now: Date = new Date(),
  count = 5
): OccurrenceCheck {
  const duration = endsAt.getTime() - startsAt.getTime();
  if (!(duration > 0)) return { ok: false, error: 'The end must be after the start.' };
  if (duration > PREPAGING_LIMITS.maxWindowDays * DAY_MS)
    return { ok: false, error: 'A window lasts at most seven days.' };
  if (recurrence) {
    try {
      parseRecurrence(recurrence);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
  const horizon = new Date(Math.max(now.getTime(), startsAt.getTime()) + 400 * DAY_MS);
  const spans = windowSpans(startsAt, endsAt, recurrence, now, horizon).slice(0, count);
  return {
    ok: true,
    occurrences: spans.map(span => ({
      startsAt: new Date(span.startsAt),
      endsAt: new Date(span.endsAt),
    })),
  };
}

export interface AgendaWindow {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  recurrence: string | null;
  enabled: boolean;
  endedAt: Date | null;
  effect: 'SUPPRESS' | 'DOWNGRADE';
}

export interface AgendaEntry {
  windowId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
  recurring: boolean;
  effect: 'SUPPRESS' | 'DOWNGRADE';
}

export interface AgendaDay {
  /** YYYY-MM-DD (UTC). */
  date: string;
  entries: AgendaEntry[];
}

/**
 * Occurrences of every enabled, not-ended window over the next `days`, grouped by UTC start day. A
 * window already in progress appears on today. Bounded: at most `perWindow` occurrences per window.
 */
export function buildMaintenanceAgenda(
  windows: readonly AgendaWindow[],
  now: Date = new Date(),
  days = 14,
  perWindow = 31
): AgendaDay[] {
  const horizon = new Date(now.getTime() + days * DAY_MS);
  const entries: AgendaEntry[] = [];
  for (const window of windows) {
    if (!window.enabled) continue;
    if (window.endedAt && window.endedAt.getTime() <= now.getTime()) continue;
    let spans: Array<{ startsAt: number; endsAt: number }> = [];
    try {
      spans = windowSpans(window.startsAt, window.endsAt, window.recurrence, now, horizon);
    } catch {
      continue; // A rule that no longer parses is listed below the calendar, never breaks it.
    }
    for (const span of spans.slice(0, perWindow))
      entries.push({
        windowId: window.id,
        name: window.name,
        startsAt: new Date(span.startsAt),
        endsAt: new Date(span.endsAt),
        active: span.startsAt <= now.getTime() && span.endsAt >= now.getTime(),
        recurring: window.recurrence !== null,
        effect: window.effect,
      });
  }
  entries.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const today = now.toISOString().slice(0, 10);
  const byDay = new Map<string, AgendaEntry[]>();
  for (const entry of entries) {
    const day = entry.active ? today : entry.startsAt.toISOString().slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(entry);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, entries: list }));
}

/**
 * Where to replay a window against history. A window (or a recurring window's anchor) that starts after
 * `now` is moved back by whole weeks so the same weekday and time falls inside the last week; the
 * preview says so. Windows that already overlap the past are replayed where they are.
 */
export function shiftIntoReplayRange(
  startsAt: Date,
  endsAt: Date,
  now: Date = new Date()
): { startsAt: Date; endsAt: Date; shiftedWeeks: number } {
  if (startsAt.getTime() <= now.getTime()) return { startsAt, endsAt, shiftedWeeks: 0 };
  const weeks = Math.ceil((startsAt.getTime() - now.getTime()) / WEEK_MS);
  return {
    startsAt: new Date(startsAt.getTime() - weeks * WEEK_MS),
    endsAt: new Date(endsAt.getTime() - weeks * WEEK_MS),
    shiftedWeeks: weeks,
  };
}

export const MATCHER_FIELD_LABELS = new Map<string, string>([
  ['severity', 'Severity'],
  ['source', 'Source'],
  ['summary', 'Summary'],
  ['resourceKey', 'Resource'],
  ['label', 'Label'],
  ['fingerprintHash', 'Content fingerprint'],
  ['dedupKey', 'Dedup key'],
] satisfies Array<[(typeof MATCHER_FIELDS)[number], string]>);

export const MATCHER_OP_LABELS = new Map<string, string>([
  ['equals', 'equals'],
  ['contains', 'contains'],
  ['prefix', 'starts with'],
  ['regex', 'matches regex'],
  ['exists', 'exists'],
]);

export type MatcherDraft = { field: string; key: string; op: string; value: string };

export const emptyMatcher = (): MatcherDraft => ({
  field: 'severity',
  key: '',
  op: 'equals',
  value: '',
});

export function draftFromMatcher(matcher: Matcher): MatcherDraft {
  return {
    field: matcher.field,
    key: matcher.key ?? '',
    op: matcher.op,
    value: matcher.value ?? '',
  };
}

/** Turns builder rows into matchers, with one message per invalid row (null when the row is valid). */
export function validateMatcherDrafts(drafts: readonly MatcherDraft[]): {
  matchers: Matcher[] | null;
  errors: Array<string | null>;
} {
  const matchers: Matcher[] = [];
  const errors = drafts.map(draft => {
    const parsed = matcherSchema.safeParse({
      field: draft.field,
      key: draft.field === 'label' ? draft.key.trim() || undefined : undefined,
      op: draft.op,
      value: draft.op === 'exists' ? undefined : draft.value,
    });
    if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid condition';
    matchers.push(parsed.data);
    return null;
  });
  if (drafts.length === 0) return { matchers: null, errors: ['Add at least one condition'] };
  if (drafts.length > PREPAGING_LIMITS.maxMatchers)
    return { matchers: null, errors: [`At most ${PREPAGING_LIMITS.maxMatchers} conditions`] };
  return { matchers: errors.every(error => error === null) ? matchers : null, errors };
}

export function describeMatcher(matcher: {
  field: string;
  key?: string;
  op: string;
  value?: string;
}): string {
  const field =
    matcher.field === 'label'
      ? `label ${matcher.key ?? ''}`
      : (MATCHER_FIELD_LABELS.get(matcher.field) ?? matcher.field).toLowerCase();
  const op = MATCHER_OP_LABELS.get(matcher.op) ?? matcher.op;
  return matcher.op === 'exists' ? `${field} exists` : `${field} ${op} "${matcher.value ?? ''}"`;
}

/** A rule id from its name: lowercase, dashes, unique among `taken`. */
export function slugifyRuleId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'rule';
  let candidate = /^[a-z0-9]/.test(base) ? base : `r-${base}`;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`.slice(0, 64);
  return candidate;
}

/** Moves the item at `from` to `to` (clamped), returning a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (from === target || from < 0 || from >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** Validates a list of orchestration rules; errors are keyed by rule index. */
export function validateOrchestrationRules(rules: readonly unknown[]): {
  rules: OrchestrationRule[] | null;
  errors: Map<number, string>;
} {
  const errors = new Map<number, string>();
  const parsed: OrchestrationRule[] = [];
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    const result = orchestrationRuleSchema.safeParse(rule);
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      errors.set(index, `${where}${issue?.message ?? 'Invalid rule'}`);
      return;
    }
    if (seen.has(result.data.id)) errors.set(index, `Duplicate rule id "${result.data.id}"`);
    seen.add(result.data.id);
    parsed.push(result.data);
  });
  if (rules.length > PREPAGING_LIMITS.maxOrchestrationRules)
    errors.set(-1, `At most ${PREPAGING_LIMITS.maxOrchestrationRules} rules`);
  return { rules: errors.size ? null : parsed, errors };
}
