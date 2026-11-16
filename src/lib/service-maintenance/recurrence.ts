import { isValidTimeZone, resolveLocalDateTimeInTimeZone } from '@/lib/timezone';

// Pure recurrence math for maintenance schedules. Wall-clock fields are in the
// schedule's IANA zone, so a 02:00 start stays 02:00 local across DST.

export type MaintenanceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface MaintenanceRecurrence {
  frequency: MaintenanceFrequency;
  interval: number;
  /** WEEKLY: local weekdays, 0 = Sunday. */
  byWeekday: number[];
  /** MONTHLY: 1-31; shorter months use their last day. */
  dayOfMonth: number | null;
  timeZone: string;
  /** Local "HH:mm". */
  startTime: string;
  durationMinutes: number;
  /** Local "YYYY-MM-DD". */
  startsOn: string;
  /** Local "YYYY-MM-DD", inclusive. */
  endsOn: string | null;
}

export interface Occurrence {
  startsAt: Date;
  endsAt: Date;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const parseKey = (key: string) => key.split('-').map(Number) as [number, number, number];
const dayNumber = (key: string) => {
  const [y, m, d] = parseKey(key);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const keyOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
// 1970-01-01 was a Thursday.
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function localDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return dayNumber(parts);
}

function matches(rule: MaintenanceRecurrence, day: number): boolean {
  const start = dayNumber(rule.startsOn);
  if (day < start || (rule.endsOn && day > dayNumber(rule.endsOn))) return false;
  if (rule.frequency === 'DAILY') return (day - start) % rule.interval === 0;
  if (rule.frequency === 'WEEKLY') {
    const weekday = weekdayOf(day);
    if (!rule.byWeekday.includes(weekday)) return false;
    const weeks = (day - weekday - (start - weekdayOf(start))) / 7;
    return weeks % rule.interval === 0;
  }
  const [y, m, d] = parseKey(keyOf(day));
  const [sy, sm] = parseKey(rule.startsOn);
  if ((y * 12 + m - (sy * 12 + sm)) % rule.interval !== 0) return false;
  return d === Math.min(rule.dayOfMonth ?? 1, daysInMonth(y, m));
}

function occurrenceOn(rule: MaintenanceRecurrence, day: number): Occurrence | null {
  const [year, month, dayOfMonth] = parseKey(keyOf(day));
  const [hour, minute] = rule.startTime.split(':').map(Number);
  // 'compatible': a repeated (fall-back) time takes the first instant; a skipped
  // (spring-forward) time moves forward by the gap, as RFC 5545 and Temporal do.
  const startsAt = resolveLocalDateTimeInTimeZone(
    { year, month, day: dayOfMonth, hour, minute },
    rule.timeZone,
    'compatible'
  );
  if (!startsAt) return null;
  return { startsAt, endsAt: new Date(startsAt.getTime() + rule.durationMinutes * 60_000) };
}

/** Occurrences whose start falls in [from, to], oldest first. */
export function occurrencesBetween(
  rule: MaintenanceRecurrence,
  from: Date,
  to: Date,
  limit = 100
): Occurrence[] {
  const result: Occurrence[] = [];
  // One day of slack each side: a gap shift can move a start across midnight.
  const last = localDay(to, rule.timeZone) + 1;
  for (let day = localDay(from, rule.timeZone) - 1; day <= last; day++) {
    if (!matches(rule, day)) continue;
    const occurrence = occurrenceOn(rule, day);
    if (!occurrence) continue;
    if (occurrence.startsAt < from || occurrence.startsAt > to) continue;
    result.push(occurrence);
    if (result.length >= limit) break;
  }
  return result;
}

/** The first occurrence starting at or after `after`, or null when the schedule has run out. */
export function nextOccurrence(rule: MaintenanceRecurrence, after: Date): Occurrence | null {
  const first = Math.max(localDay(after, rule.timeZone) - 1, dayNumber(rule.startsOn));
  // Interval is capped at 52, so a monthly rule repeats within ~4.4 years.
  const last = Math.min(
    first + 1650,
    rule.endsOn ? dayNumber(rule.endsOn) : Number.POSITIVE_INFINITY
  );
  for (let day = first; day <= last; day++) {
    if (!matches(rule, day)) continue;
    const occurrence = occurrenceOn(rule, day);
    if (occurrence && occurrence.startsAt >= after) return occurrence;
  }
  return null;
}

/** Shortest nominal gap between two consecutive starts, in minutes. */
export function minOccurrenceGapMinutes(rule: MaintenanceRecurrence): number {
  if (rule.frequency === 'DAILY') return rule.interval * 1440;
  if (rule.frequency === 'MONTHLY') return rule.interval * 28 * 1440;
  const days = [...new Set(rule.byWeekday)].sort((a, b) => a - b);
  // Wrap-around gap from the last weekday to the first one of the next active week.
  let gap = 7 * rule.interval - (days.at(-1) ?? 0) + (days.at(0) ?? 0);
  for (let i = 1; i < days.length; i++) {
    gap = Math.min(gap, (days.at(i) ?? 0) - (days.at(i - 1) ?? 0));
  }
  return gap * 1440;
}

/** Returns a user-facing error, or null when the rule is valid. */
export function recurrenceError(rule: MaintenanceRecurrence): string | null {
  if (!isValidTimeZone(rule.timeZone)) return 'Choose a valid time zone.';
  if (rule.frequency === 'WEEKLY' && rule.byWeekday.length === 0) {
    return 'Choose at least one weekday.';
  }
  if (rule.frequency === 'MONTHLY' && !rule.dayOfMonth) return 'Choose a day of the month.';
  if (rule.endsOn && rule.endsOn < rule.startsOn) return 'The end date must be after the start.';
  // An hour of slack: a DST change can shorten the real gap by up to an hour.
  if (rule.durationMinutes > minOccurrenceGapMinutes(rule) - 60) {
    return 'Each occurrence must end at least an hour before the next one starts.';
  }
  return null;
}

function formatDuration(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, mins && `${mins}m`].filter(Boolean).join(' ');
}

/** e.g. "Every Sunday 02:00–04:00 Asia/Kolkata". */
export function describeRecurrence(rule: MaintenanceRecurrence): string {
  const n = rule.interval;
  let cadence: string;
  if (rule.frequency === 'DAILY') {
    cadence = n === 1 ? 'Every day' : `Every ${n} days`;
  } else if (rule.frequency === 'WEEKLY') {
    const days = [...rule.byWeekday].sort((a, b) => a - b);
    const names = days.map(d => {
      const name = WEEKDAYS.at(d) ?? '';
      return days.length === 1 ? name : name.slice(0, 3);
    });
    cadence = n === 1 ? `Every ${names.join(', ')}` : `Every ${n} weeks on ${names.join(', ')}`;
  } else {
    const day = rule.dayOfMonth === 31 ? 'the last day' : `day ${rule.dayOfMonth}`;
    cadence = n === 1 ? `Monthly on ${day}` : `Every ${n} months on ${day}`;
  }
  const [h, m] = rule.startTime.split(':').map(Number);
  const endMinute = (h * 60 + m + rule.durationMinutes) % 1440;
  const end = `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`;
  const time =
    rule.durationMinutes < 1440
      ? `${rule.startTime}–${end}`
      : `${rule.startTime} for ${formatDuration(rule.durationMinutes)}`;
  const until = rule.endsOn ? `, until ${rule.endsOn}` : '';
  return `${cadence} ${time} ${rule.timeZone}${until}`;
}
