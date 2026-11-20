import {
  type RetentionDurations,
  createTimeContractContext,
  normalizeContractTimeZone,
  resolveReportingWindow,
} from '@/lib/time-retention-contract';
import { startOfDayFromDateKey } from '@/lib/timezone';
import type { AnalyticsParams } from './params';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type AnalyticsBucket = 'hour' | 'day' | 'week' | 'month';

/**
 * Every analytics window is half-open: [start, end). The previous window has
 * the same length and ends exactly where the current one starts, so no
 * incident is counted in both.
 */
export type AnalyticsWindow = {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  bucket: AnalyticsBucket;
  /** Viewer timezone: charts and the heatmap bucket in it. */
  timeZone: string;
  /** Tenant business-hours timezone: after-hours and responder bands use it. */
  businessTimeZone: string;
  /** True when retention or "now" shortened the requested range. */
  isClipped: boolean;
  /** False when the previous period would reach past retention; it is then empty. */
  hasPrevious: boolean;
};

function rangeMs(params: AnalyticsParams): number {
  if (params.range === 'custom' && params.from && params.to) {
    return params.to.getTime() - params.from.getTime();
  }
  if (params.range === '24h') return DAY_MS;
  return parseInt(params.range, 10) * DAY_MS;
}

export function bucketFor(lengthMs: number): AnalyticsBucket {
  if (lengthMs <= 2 * DAY_MS) return 'hour';
  if (lengthMs <= 92 * DAY_MS) return 'day';
  if (lengthMs <= 400 * DAY_MS) return 'week';
  return 'month';
}

export function resolveAnalyticsWindow(input: {
  params: AnalyticsParams;
  policy: RetentionDurations & { businessHoursTimeZone?: string | null };
  userTimeZone?: string | null;
  now?: Date;
}): AnalyticsWindow {
  const context = createTimeContractContext({
    now: input.now,
    userTimeZone: input.userTimeZone,
    businessTimeZone: input.policy.businessHoursTimeZone,
  });
  const timeZone = normalizeContractTimeZone(input.userTimeZone);
  const { from, to } = input.params;
  const custom = input.params.range === 'custom' && from && to;
  // Custom ranges are calendar days in the viewer's timezone: midnight to midnight local.
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const requestedEnd = custom ? startOfDayFromDateKey(dayKey(to), timeZone) : context.now;
  const requestedStart = custom
    ? startOfDayFromDateKey(dayKey(from), timeZone)
    : new Date(requestedEnd.getTime() - rangeMs(input.params));
  const resolved = resolveReportingWindow({
    context,
    policy: input.policy,
    requestedStart,
    requestedEnd,
  });
  const { start, end } = resolved.effective;
  const length = end.getTime() - start.getTime();
  // A comparison period older than retention would read purged (or not-yet-purged)
  // data and show a misleading baseline, so it is dropped instead.
  const previousStart = new Date(start.getTime() - length);
  const hasPrevious = previousStart >= resolved.retentionStart;
  return {
    start,
    end,
    previousStart: hasPrevious ? previousStart : start,
    previousEnd: start,
    bucket: bucketFor(length),
    timeZone,
    businessTimeZone: context.businessTimeZone,
    isClipped: resolved.isClipped,
    hasPrevious,
  };
}
