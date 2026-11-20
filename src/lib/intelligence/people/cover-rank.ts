import { localHour } from '@/lib/oncall-load/metrics';

/** Pure parts of the override cover suggestions. No database, so they are unit-tested directly. */

export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 22;
const HOUR_MS = 3_600_000;

/** True when some part of [start, end) has nobody on call. */
export function hasUncoveredTime(
  shifts: ReadonlyArray<{ start: Date; end: Date }>,
  start: Date,
  end: Date
): boolean {
  const spans = shifts
    .map(
      shift =>
        [
          Math.max(shift.start.getTime(), start.getTime()),
          Math.min(shift.end.getTime(), end.getTime()),
        ] as const
    )
    .filter(([from, to]) => from < to)
    .sort((a, b) => a[0] - b[0]);
  let coveredUntil = start.getTime();
  for (const [from, to] of spans) {
    if (from > coveredUntil) return true;
    coveredUntil = Math.max(coveredUntil, to);
  }
  return coveredUntil < end.getTime();
}

/**
 * True when the whole window falls between 08:00 and 22:00 on the person's own clock. Checked hour by hour
 * (plus the last instant), so a window longer than 14 hours is never daytime.
 */
export function isDaytimeFor(start: Date, end: Date, timeZone: string | null | undefined): boolean {
  const inDay = (instant: Date) => {
    const hour = localHour(instant, timeZone);
    return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
  };
  for (let t = start.getTime(); t < end.getTime(); t += HOUR_MS) {
    if (!inDay(new Date(t))) return false;
  }
  return inDay(new Date(end.getTime() - 1));
}

export type RankableCandidate = {
  userId: string;
  name: string;
  daytime: boolean;
  pages: number;
  nightPages: number;
};

/** Daytime for them first, then fewest pages, then fewest night pages, then name. */
export function rankCoverCandidates<T extends RankableCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort(
    (a, b) =>
      Number(b.daytime) - Number(a.daytime) ||
      a.pages - b.pages ||
      a.nightPages - b.nightPages ||
      a.name.localeCompare(b.name)
  );
}
