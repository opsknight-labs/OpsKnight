import {
  type RetentionDurations,
  createTimeContractContext,
  normalizeContractTimeZone,
  resolveReportingWindow,
} from '@/lib/time-retention-contract';
import type { AnalyticsParams } from './params';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type AnalyticsBucket = 'hour' | 'day' | 'week';

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
  return 'week';
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
  const custom = input.params.range === 'custom';
  const requestedEnd = custom ? input.params.to : context.now;
  const requestedStart = new Date((requestedEnd ?? context.now).getTime() - rangeMs(input.params));
  const resolved = resolveReportingWindow({
    context,
    policy: input.policy,
    requestedStart,
    requestedEnd,
  });
  const { start, end } = resolved.effective;
  const length = end.getTime() - start.getTime();
  return {
    start,
    end,
    previousStart: new Date(start.getTime() - length),
    previousEnd: start,
    bucket: bucketFor(length),
    timeZone: normalizeContractTimeZone(input.userTimeZone),
    businessTimeZone: context.businessTimeZone,
    isClipped: resolved.isClipped,
  };
}
