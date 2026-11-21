import {
  addDaysToDateKey,
  formatDateKeyInTimeZone,
  startOfDayFromDateKey,
  startOfNextDayFromDateKey,
} from '@/lib/timezone';

/** Pure on-call coverage maths. No database access: callers pass effective blocks from `getFinalScheduleBlocks`. */

export type CoverageBlock = { start: Date; end: Date; userId: string; layerId: string };

/** One person's effective on-call time on one calendar day (schedule time zone) through one layer. */
export type CoverageDay = { date: string; userId: string; layerId: string; seconds: number };

/** Date keys from `fromDateKey` (inclusive) to `toDateKey` (exclusive), at most 400. */
export function dateKeyRange(fromDateKey: string, toDateKey: string): string[] {
  const keys: string[] = [];
  let key = fromDateKey;
  while (key < toDateKey && keys.length < 400) {
    keys.push(key);
    key = addDaysToDateKey(key, 1);
  }
  return keys;
}

/**
 * Splits effective blocks into per-day totals. Days are calendar days in the schedule's time zone,
 * so a DST day is 23 or 25 hours long and still sums to the real elapsed seconds.
 */
export function buildCoverageDays(
  blocks: readonly CoverageBlock[],
  timeZone: string,
  fromDateKey: string,
  toDateKey: string
): CoverageDay[] {
  const totals = new Map<string, CoverageDay>();
  for (const date of dateKeyRange(fromDateKey, toDateKey)) {
    const dayStart = startOfDayFromDateKey(date, timeZone).getTime();
    const dayEnd = startOfNextDayFromDateKey(date, timeZone).getTime();
    for (const block of blocks) {
      const overlap =
        Math.min(block.end.getTime(), dayEnd) - Math.max(block.start.getTime(), dayStart);
      if (overlap <= 0) continue;
      const seconds = Math.round(overlap / 1000);
      const key = `${date}|${block.userId}|${block.layerId}`;
      const row = totals.get(key);
      if (row) row.seconds += seconds;
      else totals.set(key, { date, userId: block.userId, layerId: block.layerId, seconds });
    }
  }
  return [...totals.values()];
}

/**
 * Calendar days (schedule time zone), starting today, on which some part of the day has nobody on call.
 * The one implementation behind the schedule health check and the coverage-gap insight.
 */
export function findCoverageGapDays(
  shifts: ReadonlyArray<{ start: Date | string; end: Date | string }>,
  timeZone: string,
  now: Date,
  days: number
): string[] {
  const zone = timeZone || 'UTC';
  const spans = shifts.map(
    shift => [new Date(shift.start).getTime(), new Date(shift.end).getTime()] as const
  );
  const todayKey = formatDateKeyInTimeZone(now, zone);
  return dateKeyRange(todayKey, addDaysToDateKey(todayKey, days)).filter(dateKey => {
    const dayStart = startOfDayFromDateKey(dateKey, zone).getTime();
    const dayEnd = startOfNextDayFromDateKey(dateKey, zone).getTime();
    const intervals = spans
      .map(([start, end]) => [Math.max(start, dayStart), Math.min(end, dayEnd)] as const)
      .filter(([start, end]) => start < end)
      .sort((a, b) => a[0] - b[0]);

    let coveredUntil = dayStart;
    for (const [start, end] of intervals) {
      if (start > coveredUntil) return true;
      coveredUntil = Math.max(coveredUntil, end);
      if (coveredUntil >= dayEnd) return false;
    }
    return coveredUntil < dayEnd;
  });
}
