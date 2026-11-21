import { createDateTimeFormatterCache } from '@/lib/date-time-format';
import { isValidTimeZone } from '@/lib/timezone';

/**
 * Pure on-call load maths over page buckets.
 *
 * A bucket has the same grain as the `ops.pages.user_hour` daily rollup (one row per person, UTC day,
 * hour of day in the person's time zone, weekend flag), so the raw `Notification` source in `store.ts`
 * can be swapped for the rollup without touching this file.
 */
export type PageBucket = {
  userId: string;
  /** UTC calendar day of the pages, YYYY-MM-DD. */
  day: string;
  /** Hour of day (0-23) in the person's time zone. */
  hour: number;
  /** Saturday or Sunday in the person's time zone. */
  weekend: boolean;
  /** Distinct incidents that paged the person in this bucket. */
  pages: number;
};

export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 7;
const HOUR_MS = 3_600_000;
const WEEK_SECONDS = 7 * 24 * 3600;

/** Night is 22:00-07:00 on the person's own clock. The hour is already local, so DST needs no handling here. */
export function isNightHour(hour: number): boolean {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

const getHourFormatter = createDateTimeFormatterCache('en-US', {
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Hour of day (0-23) of an instant on a time zone's wall clock; an unknown zone is read as UTC. */
export function localHour(instant: Date, timeZone: string | null | undefined): number {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return Number(getHourFormatter(zone).format(instant)) % 24;
}

/**
 * The start of the hour a bucket stands for. Scans the UTC day for the hour whose local hour matches,
 * which is DST-safe: on a fall-back day the repeated local hour resolves to its first occurrence, and
 * a zone with a 30 or 45 minute offset resolves to the UTC hour that starts inside that local hour.
 */
export function bucketInstant(
  bucket: Pick<PageBucket, 'day' | 'hour'>,
  timeZone: string | null | undefined
): Date {
  const dayStart = Date.parse(`${bucket.day}T00:00:00.000Z`);
  for (let index = 0; index < 24; index += 1) {
    const instant = new Date(dayStart + index * HOUR_MS);
    if (localHour(instant, timeZone) === bucket.hour) return instant;
  }
  return new Date(dayStart);
}

export type PersonLoad = {
  userId: string;
  pages: number;
  nightPages: number;
  weekendPages: number;
  /** Clock hours in which at least one page arrived. */
  interruptedHours: number;
  /** Distinct days with at least one night page. */
  nightsPaged: number;
  /** How many of the window's 7-day periods had a night page. */
  weeksWithNightPages: number;
  /** Longest stretch without a page inside the window, in hours. */
  longestQuietGapHours: number;
  onCallHours: number;
  /** Pages per week of on-call time: the number rotations are compared on. Null without on-call time. */
  pagesPerOnCallWeek: number | null;
  /** `pagesPerOnCallWeek` divided by the rotation mean. Null when either is unknown or the mean is zero. */
  vsRotationMean: number | null;
  /** Pages per UTC day across the window, oldest first, zero-filled. */
  daily: Array<{ day: string; pages: number }>;
};

export type RotationLoad = {
  people: PersonLoad[];
  totalPages: number;
  /** Mean of `pagesPerOnCallWeek` across people who were on call. Null when nobody was. */
  meanPagesPerOnCallWeek: number | null;
  /**
   * Jain's fairness index over `pagesPerOnCallWeek`: 1 means the load per on-call week was equal,
   * 1/n means one person took all of it. Null with fewer than two people on call or no pages.
   */
  fairnessIndex: number | null;
};

export type LoadInput = {
  buckets: readonly PageBucket[];
  /** The rotation: everyone to report on, with their time zone. */
  users: ReadonlyArray<{ userId: string; timeZone?: string | null }>;
  /** Effective on-call seconds in the window per person. */
  onCallSeconds: ReadonlyMap<string, number>;
  from: Date;
  to: Date;
};

function utcDayKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let time = start; time < to.getTime() && keys.length < 400; time += 24 * HOUR_MS) {
    keys.push(new Date(time).toISOString().slice(0, 10));
  }
  return keys;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function computeLoad(input: LoadInput): RotationLoad {
  const days = utcDayKeys(input.from, input.to);
  const byUser = new Map<string, PageBucket[]>();
  for (const bucket of input.buckets) {
    if (bucket.pages <= 0) continue;
    const list = byUser.get(bucket.userId);
    if (list) list.push(bucket);
    else byUser.set(bucket.userId, [bucket]);
  }

  const people: PersonLoad[] = input.users.map(({ userId, timeZone }) => {
    const buckets = byUser.get(userId) ?? [];
    const perDay = new Map<string, number>();
    const nights = new Set<string>();
    const nightWeeks = new Set<number>();
    const hours = new Set<number>();
    let pages = 0;
    let nightPages = 0;
    let weekendPages = 0;
    for (const bucket of buckets) {
      pages += bucket.pages;
      perDay.set(bucket.day, (perDay.get(bucket.day) ?? 0) + bucket.pages);
      if (bucket.weekend) weekendPages += bucket.pages;
      const instant = bucketInstant(bucket, timeZone).getTime();
      hours.add(instant);
      if (isNightHour(bucket.hour)) {
        nightPages += bucket.pages;
        nights.add(bucket.day);
        nightWeeks.add(Math.floor((instant - input.from.getTime()) / (7 * 24 * HOUR_MS)));
      }
    }

    // Quiet gaps run between paged hours, and from the window edges to the first and last page.
    const sorted = [...hours].sort((a, b) => a - b);
    let longestGapMs = 0;
    let quietSince = input.from.getTime();
    for (const hourStart of sorted) {
      longestGapMs = Math.max(longestGapMs, hourStart - quietSince);
      quietSince = hourStart + HOUR_MS;
    }
    longestGapMs = Math.max(longestGapMs, input.to.getTime() - quietSince);

    const seconds = input.onCallSeconds.get(userId) ?? 0;
    return {
      userId,
      pages,
      nightPages,
      weekendPages,
      interruptedHours: hours.size,
      nightsPaged: nights.size,
      weeksWithNightPages: nightWeeks.size,
      longestQuietGapHours: Math.max(0, Math.round(longestGapMs / HOUR_MS)),
      onCallHours: round1(seconds / 3600),
      pagesPerOnCallWeek: seconds > 0 ? round1((pages * WEEK_SECONDS) / seconds) : null,
      vsRotationMean: null,
      daily: days.map(day => ({ day, pages: perDay.get(day) ?? 0 })),
    };
  });

  const rates = people
    .map(person => person.pagesPerOnCallWeek)
    .filter((rate): rate is number => rate !== null);
  const sum = rates.reduce((total, rate) => total + rate, 0);
  const squares = rates.reduce((total, rate) => total + rate * rate, 0);
  const mean = rates.length > 0 ? sum / rates.length : null;
  if (mean) {
    for (const person of people) {
      if (person.pagesPerOnCallWeek !== null) {
        person.vsRotationMean = Math.round((person.pagesPerOnCallWeek / mean) * 100) / 100;
      }
    }
  }

  return {
    people,
    totalPages: people.reduce((total, person) => total + person.pages, 0),
    meanPagesPerOnCallWeek: mean === null ? null : round1(mean),
    fairnessIndex:
      rates.length >= 2 && squares > 0
        ? Math.round(((sum * sum) / (rates.length * squares)) * 100) / 100
        : null,
  };
}
