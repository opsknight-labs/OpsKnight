import { isValidTimeZone } from './timezone';

export type RetainedDataType = 'incident' | 'alert' | 'log' | 'metrics';
export type TimeWindowClipReason = 'retention_start' | 'future_end' | 'start_after_end';

export interface RetentionDurations {
  incidentRetentionDays: number;
  alertRetentionDays: number;
  logRetentionDays: number;
  metricsRetentionDays: number;
}

export interface TimeContractContext {
  now: Date;
  userTimeZone: string;
  businessTimeZone: string;
}

export interface ReportingWindow {
  requested: { start: Date | null; end: Date | null };
  effective: { start: Date; end: Date };
  retentionStart: Date;
  dataType: RetainedDataType;
  isClipped: boolean;
  clipReasons: TimeWindowClipReason[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function validDate(value: Date | undefined): Date | undefined {
  return value && Number.isFinite(value.getTime()) ? new Date(value) : undefined;
}

export function normalizeContractTimeZone(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && isValidTimeZone(normalized) ? normalized : 'UTC';
}

export function createTimeContractContext(input: {
  now?: Date;
  userTimeZone?: string | null;
  businessTimeZone?: string | null;
}): TimeContractContext {
  const now = validDate(input.now ?? new Date());
  if (!now) throw new RangeError('A valid contract clock is required.');

  return {
    now,
    userTimeZone: normalizeContractTimeZone(input.userTimeZone),
    businessTimeZone: normalizeContractTimeZone(input.businessTimeZone),
  };
}

export function getRetentionDays(policy: RetentionDurations, dataType: RetainedDataType): number {
  switch (dataType) {
    case 'alert':
      return policy.alertRetentionDays;
    case 'log':
      return policy.logRetentionDays;
    case 'metrics':
      return policy.metricsRetentionDays;
    case 'incident':
      return policy.incidentRetentionDays;
  }
}

/**
 * Resolves an absolute reporting interval against one injected clock. Retention
 * is duration-based and therefore independent of the host machine timezone.
 */
export function resolveReportingWindow(input: {
  context: TimeContractContext;
  policy: RetentionDurations;
  dataType?: RetainedDataType;
  requestedStart?: Date;
  requestedEnd?: Date;
  defaultWindowDays?: number;
}): ReportingWindow {
  const dataType = input.dataType ?? 'incident';
  const now = new Date(input.context.now);
  const requestedStart = validDate(input.requestedStart);
  const requestedEnd = validDate(input.requestedEnd);
  const retentionDays = Math.max(0, getRetentionDays(input.policy, dataType));
  const retentionStart = new Date(now.getTime() - retentionDays * DAY_MS);
  const defaultDays =
    input.defaultWindowDays === undefined ? retentionDays : Math.max(0, input.defaultWindowDays);
  const defaultStart = new Date(now.getTime() - defaultDays * DAY_MS);
  const clipReasons: TimeWindowClipReason[] = [];

  let end = requestedEnd ?? now;
  if (end > now) {
    end = now;
    clipReasons.push('future_end');
  }

  let start = requestedStart ?? defaultStart;
  if (start < retentionStart) {
    start = retentionStart;
    clipReasons.push('retention_start');
  }
  if (start > end) {
    start = end;
    clipReasons.push('start_after_end');
  }

  return {
    requested: { start: requestedStart ?? defaultStart, end: requestedEnd ?? now },
    effective: { start, end },
    retentionStart,
    dataType,
    isClipped: clipReasons.length > 0,
    clipReasons,
  };
}
