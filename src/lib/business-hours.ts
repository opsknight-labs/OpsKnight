/**
 * Shared "business hours" classification for the SLA pipeline.
 *
 * The same timezone, start hour, and end hour must be used across:
 *   - The live SQL aggregate path (`sla-server.ts`)
 *   - The in-memory classifier (`sla-server.ts`)
 *   - The rollup-generation path (`metric-rollup.ts`)
 *
 * Otherwise the same incident is classified differently depending on
 * which code path serves the query, producing drift between live and
 * rollup results for the same date range.
 *
 * Default is UTC (matches pre-tenant behavior). The tenant-configured
 * value lives in `systemSettings.businessHoursTimeZone` and is read
 * via `getRetentionPolicy()`. This module is import-cycle safe — it
 * has no dependencies on anything inside `sla-server.ts`.
 */

export const DEFAULT_BUSINESS_HOURS_TIMEZONE = 'UTC';
export const DEFAULT_BUSINESS_HOURS_START = 8; // inclusive
export const DEFAULT_BUSINESS_HOURS_END = 18; // exclusive

/**
 * Returns true when `date` falls outside business hours
 * (Mon-Fri, startHour-endHour) when projected into `timeZone`.
 *
 * Uses `Intl.DateTimeFormat` for timezone-aware extraction so DST and
 * non-whole-hour-offset zones are handled correctly (`Date.getUTCDay()`
 * and `getUTCHours()` would only work for UTC itself).
 */
export function isIncidentAfterHours(
  date: Date,
  timeZone: string = DEFAULT_BUSINESS_HOURS_TIMEZONE,
  startHour: number = DEFAULT_BUSINESS_HOURS_START,
  endHour: number = DEFAULT_BUSINESS_HOURS_END,
  businessDays?: number[]
): boolean {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_BUSINESS_HOURS_TIMEZONE,
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_BUSINESS_HOURS_TIMEZONE,
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    });
  }
  const parts = formatter.formatToParts(date);
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  const hourStr = parts.find(p => p.type === 'hour')?.value;
  // Default to noon (i.e. NOT after-hours) when extraction fails — a
  // missing hour is almost certainly a malformed timezone, and biasing
  // toward "in-hours" avoids inflating after-hours counts on bad data.
  const hour = hourStr !== undefined ? parseInt(hourStr, 10) : 12;

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayNum = dayMap[weekday] ?? 1;
  const allowedDays = businessDays && businessDays.length > 0 ? businessDays : [1, 2, 3, 4, 5];
  const isBusinessDay = allowedDays.includes(dayNum);

  const isBusinessHours =
    startHour === endHour
      ? true // startHour === endHour represents 24-hour round-the-clock coverage
      : startHour < endHour
        ? hour >= startHour && hour < endHour
        : hour >= startHour || hour < endHour;

  return !isBusinessDay || !isBusinessHours;
}

// (Note: incident-event classification helpers live in
// `./incident-event-classifier.ts` — kept separate to avoid pulling
// Prisma types into this module, which must stay lightweight enough
// to be safely imported by rollup-generation and aggregation code.)
