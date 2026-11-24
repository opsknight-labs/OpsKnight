import {
  getDatePartsInTimeZone,
  resolveLocalDateTimeInTimeZone,
  startOfDayFromDateKey,
} from '@/lib/timezone';

/** A scheduled run stays due for this long, so enabling the feature never backfills an old month. */
export const DUE_WINDOW_HOURS = 72;

export type ReviewPeriod = { key: string; from: Date; to: Date; days: number; label: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar month before `now` in `timeZone`, e.g. run on 2026-12-01 reviews "2026-11". */
export function reviewPeriod(now: Date, timeZone: string): ReviewPeriod {
  const { year, month } = getDatePartsInTimeZone(now, timeZone);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const firstKey = `${prevYear}-${pad(prevMonth)}-01`;
  const from = startOfDayFromDateKey(firstKey, timeZone);
  const to = startOfDayFromDateKey(`${year}-${pad(month)}-01`, timeZone);
  const days = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(prevYear, prevMonth - 1, 1)));
  return { key: `${prevYear}-${pad(prevMonth)}`, from, to, days, label };
}

/** The month before `period` (its first instant reviewed as "now"), for the burn trend. */
export const priorPeriod = (period: ReviewPeriod, timeZone: string) =>
  reviewPeriod(period.from, timeZone);

/** True from the configured day and hour (org time zone) for DUE_WINDOW_HOURS. */
export function isRunDue(
  now: Date,
  schedule: { dayOfMonth: number; hour: number; timeZone: string }
): boolean {
  const { year, month } = getDatePartsInTimeZone(now, schedule.timeZone);
  const scheduled = resolveLocalDateTimeInTimeZone(
    { year, month, day: schedule.dayOfMonth, hour: schedule.hour, minute: 0 },
    schedule.timeZone,
    'compatible'
  );
  if (!scheduled) return false;
  const elapsed = now.getTime() - scheduled.getTime();
  return elapsed >= 0 && elapsed < DUE_WINDOW_HOURS * 3_600_000;
}
