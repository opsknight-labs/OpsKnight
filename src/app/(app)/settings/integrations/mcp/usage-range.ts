/**
 * The Usage tab's custom date range: whole UTC days from `from` (inclusive) to `to` (inclusive),
 * so the query covers [from 00:00, to + 1 day 00:00). Pure, so the page, the export and tests all
 * judge a range the same way.
 */

export const USAGE_RANGE_MAX_DAYS = 365;
const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD calendar date as UTC midnight, or null when it is not a real date. */
export function parseUsageDate(value: string): Date | null {
  if (!DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export const usageDay = (date: Date) => date.toISOString().slice(0, 10);

/** The earliest start date the request log can still answer for. */
export function earliestUsageDay(retentionDays: number, now: Date) {
  return usageDay(new Date(now.getTime() - Math.min(retentionDays, USAGE_RANGE_MAX_DAYS) * DAY));
}

export type UsageRangeResult =
  { ok: true; since: Date; until: Date; from: string; to: string } | { ok: false; error: string };

export function resolveUsageRange(
  from: string,
  to: string,
  retentionDays: number,
  now: Date
): UsageRangeResult {
  const start = parseUsageDate(from);
  const end = parseUsageDate(to);
  if (!start || !end) return { ok: false, error: 'Enter both dates as YYYY-MM-DD.' };
  if (start >= end) return { ok: false, error: 'The start date must be before the end date.' };
  if (from > usageDay(now)) return { ok: false, error: 'The start date is in the future.' };
  if (end.getTime() - start.getTime() > USAGE_RANGE_MAX_DAYS * DAY)
    return { ok: false, error: `A range can cover at most ${USAGE_RANGE_MAX_DAYS} days.` };
  if (from < earliestUsageDay(retentionDays, now))
    return {
      ok: false,
      error: `The request log is kept for ${retentionDays} days, so the range must start on or after ${earliestUsageDay(retentionDays, now)}.`,
    };
  return { ok: true, since: start, until: new Date(end.getTime() + DAY), from, to };
}
