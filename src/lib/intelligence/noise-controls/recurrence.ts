import { PREPAGING_LIMITS } from './contract';

/**
 * A bounded RRULE subset for maintenance windows, evaluated in UTC with no external dependency:
 * FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY (weekly), COUNT, UNTIL. Occurrences are fixed-length
 * copies of the first window. Validation runs when a window is saved; the hook only compares instants.
 */

export interface Recurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  byDay: number[]; // 0 = Sunday … 6 = Saturday (JS getUTCDay)
  count: number | null;
  until: Date | null;
}

export interface Span {
  startsAt: number;
  endsAt: number;
}

const WEEKDAYS = new Map<string, number>([
  ['SU', 0],
  ['MO', 1],
  ['TU', 2],
  ['WE', 3],
  ['TH', 4],
  ['FR', 5],
  ['SA', 6],
]);
const DAY_MS = 86_400_000;

/** UNTIL is `YYYYMMDD` or `YYYYMMDDTHHMMSS[Z]`, parsed by position so no regular expression is involved. */
function parseUntil(value: string): Date | null {
  const digits = value.replace(/Z$/, '').replace('T', '');
  if (!/^\d+$/.test(digits) || (digits.length !== 8 && digits.length !== 14)) return null;
  const part = (from: number, length: number, fallback: number) =>
    digits.length > from ? Number(digits.slice(from, from + length)) : fallback;
  const date = new Date(
    Date.UTC(
      part(0, 4, 0),
      part(4, 2, 1) - 1,
      part(6, 2, 1),
      part(8, 2, 23),
      part(10, 2, 59),
      part(12, 2, 59)
    )
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseRecurrence(text: string): Recurrence {
  if (text.length > 512) throw new Error('Recurrence is too long');
  const parts = text.split(';').filter(Boolean);
  const seen = new Set<string>();
  const rule: Recurrence = { freq: 'DAILY', interval: 1, byDay: [], count: null, until: null };
  let hasFreq = false;
  for (const part of parts) {
    const match = /^([A-Z]+)=([A-Z0-9,+-]+)$/.exec(part);
    if (!match) throw new Error(`Invalid recurrence part "${part}"`);
    const [, key, value] = match;
    if (seen.has(key)) throw new Error(`Duplicate recurrence option ${key}`);
    seen.add(key);
    switch (key) {
      case 'FREQ':
        if (value !== 'DAILY' && value !== 'WEEKLY' && value !== 'MONTHLY')
          throw new Error('FREQ must be DAILY, WEEKLY or MONTHLY');
        rule.freq = value;
        hasFreq = true;
        break;
      case 'INTERVAL': {
        const interval = Number(value);
        if (!Number.isInteger(interval) || interval < 1 || interval > 365)
          throw new Error('INTERVAL must be between 1 and 365');
        rule.interval = interval;
        break;
      }
      case 'BYDAY':
        rule.byDay = [
          ...new Set(
            value.split(',').map(day => {
              const weekday = WEEKDAYS.get(day);
              if (weekday === undefined) throw new Error(`Unknown BYDAY value "${day}"`);
              return weekday;
            })
          ),
        ].sort();
        break;
      case 'COUNT': {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1 || count > PREPAGING_LIMITS.maxRecurrenceCount)
          throw new Error(`COUNT must be between 1 and ${PREPAGING_LIMITS.maxRecurrenceCount}`);
        rule.count = count;
        break;
      }
      case 'UNTIL': {
        const until = parseUntil(value);
        if (!until) throw new Error('UNTIL must look like 20260131T235959Z');
        rule.until = until;
        break;
      }
      default:
        throw new Error(`Unsupported recurrence option ${key}`);
    }
  }
  if (!hasFreq) throw new Error('Recurrence needs FREQ');
  if (rule.byDay.length && rule.freq !== 'WEEKLY')
    throw new Error('BYDAY is only supported with FREQ=WEEKLY');
  return rule;
}

function addMonthsUTC(date: Date, months: number): Date | null {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const candidate = new Date(
    Date.UTC(
      year,
      month,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
  // Skip months that do not have this day of month (31st of February), like RRULE does.
  return candidate.getUTCDate() === date.getUTCDate() ? candidate : null;
}

/**
 * Occurrence starts of `rule` anchored at `dtstart` that fall in [rangeStart, rangeEnd], in order,
 * bounded by `limit`. The first occurrence is always `dtstart` itself (RRULE semantics).
 */
export function occurrencesBetween(
  dtstart: Date,
  rule: Recurrence,
  rangeStart: Date,
  rangeEnd: Date,
  limit = 500
): Date[] {
  const out: Date[] = [];
  let produced = 0;
  const emit = (at: Date): boolean => {
    if (rule.until && at.getTime() > rule.until.getTime()) return false;
    produced += 1;
    if (rule.count !== null && produced > rule.count) return false;
    if (at.getTime() >= rangeStart.getTime() && at.getTime() <= rangeEnd.getTime()) out.push(at);
    return at.getTime() <= rangeEnd.getTime() && out.length < limit;
  };
  if (rule.freq === 'DAILY') {
    for (let k = 0; k < PREPAGING_LIMITS.maxRecurrenceCount; k += 1) {
      if (!emit(new Date(dtstart.getTime() + k * rule.interval * DAY_MS))) break;
    }
    return out;
  }
  if (rule.freq === 'MONTHLY') {
    for (let k = 0; k < PREPAGING_LIMITS.maxRecurrenceCount; k += 1) {
      const at = addMonthsUTC(dtstart, k * rule.interval);
      if (at === null) {
        if (k * rule.interval > 1200) break; // 100 years of skipped months: give up
        continue;
      }
      if (!emit(at)) break;
    }
    return out;
  }
  // WEEKLY: the week of dtstart (Monday-based) is week 0; BYDAY lists the weekdays inside each week,
  // visited in week order (Monday first, Sunday last) so occurrences come out chronologically.
  const days = [...(rule.byDay.length ? rule.byDay : [dtstart.getUTCDay()])].sort(
    (a, b) => ((a + 6) % 7) - ((b + 6) % 7)
  );
  const mondayOffset = (dtstart.getUTCDay() + 6) % 7;
  const weekStart = dtstart.getTime() - mondayOffset * DAY_MS;
  for (let week = 0; week < PREPAGING_LIMITS.maxRecurrenceCount; week += 1) {
    const base = weekStart + week * rule.interval * 7 * DAY_MS;
    let stop = false;
    for (const day of days) {
      const at = new Date(base + ((day + 6) % 7) * DAY_MS);
      if (at.getTime() < dtstart.getTime()) continue;
      if (!emit(at)) {
        stop = true;
        break;
      }
    }
    if (stop) break;
  }
  return out;
}

/**
 * Spans of a window (first occurrence `startsAt`–`endsAt`, optional recurrence) that overlap
 * [rangeStart, rangeEnd]. One-off windows return at most one span.
 */
export function windowSpans(
  startsAt: Date,
  endsAt: Date,
  recurrence: string | null,
  rangeStart: Date,
  rangeEnd: Date
): Span[] {
  const duration = endsAt.getTime() - startsAt.getTime();
  if (duration <= 0) return [];
  const overlaps = (span: Span) =>
    span.endsAt >= rangeStart.getTime() && span.startsAt <= rangeEnd.getTime();
  if (!recurrence) {
    const span = { startsAt: startsAt.getTime(), endsAt: endsAt.getTime() };
    return overlaps(span) ? [span] : [];
  }
  const rule = parseRecurrence(recurrence);
  return occurrencesBetween(startsAt, rule, new Date(rangeStart.getTime() - duration), rangeEnd)
    .map(start => ({ startsAt: start.getTime(), endsAt: start.getTime() + duration }))
    .filter(overlaps);
}

export function isWindowActiveAt(
  window: { startsAt: Date; endsAt: Date; recurrence: string | null },
  at: Date
): boolean {
  return windowSpans(window.startsAt, window.endsAt, window.recurrence, at, at).length > 0;
}

/** Validates a window's shape and recurrence the way the UI and API need it; throws a plain Error. */
export function validateWindowTiming(
  startsAt: Date,
  endsAt: Date,
  recurrence: string | null | undefined,
  now: Date = new Date()
): void {
  const duration = endsAt.getTime() - startsAt.getTime();
  if (!(duration > 0 && duration <= PREPAGING_LIMITS.maxWindowDays * DAY_MS))
    throw new Error('A window lasts between one minute and seven days');
  if (!recurrence) return;
  parseRecurrence(recurrence);
  if (startsAt.getTime() < now.getTime() - 5 * 366 * DAY_MS)
    throw new Error('A recurring window cannot start more than five years ago');
}
