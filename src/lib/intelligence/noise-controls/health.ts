import { runtimeOperationalMetrics } from '@/lib/metrics/operational/registry';
import { prePagingDeadlineMs } from './lookup-client';

/** Fewer lookups than this say nothing about the deadline. */
const MIN_LOOKUPS = 20;
/** The share of lookups that failed open from which the page warns. */
const WARN_RATE = 0.25;

export interface PrePagingLookupHealth {
  lookups: number;
  failedOpen: number;
  rate: number;
  deadlineMs: number;
  warn: boolean;
}

/** Pure part: the counter rows `opsknight_prepaging_lookups_total{outcome}` summed. */
export function summarizeLookupHealth(
  rows: ReadonlyArray<{ labels: Record<string, string>; value: number }>,
  deadlineMs: number
): PrePagingLookupHealth {
  let lookups = 0;
  let failedOpen = 0;
  for (const row of rows) {
    lookups += row.value;
    if (row.labels.outcome === 'fail_open') failedOpen += row.value;
  }
  const rate = lookups > 0 ? failedOpen / lookups : 0;
  return {
    lookups,
    failedOpen,
    rate,
    deadlineMs,
    warn: lookups >= MIN_LOOKUPS && rate >= WARN_RATE,
  };
}

/**
 * How many dedup / flapping / storm lookups this server abandoned at the deadline since it started. Only
 * this process's counters: another replica's are not visible here, and a process that has not evaluated
 * anything reports no warning.
 */
export function currentLookupHealth(): PrePagingLookupHealth {
  return summarizeLookupHealth(
    runtimeOperationalMetrics().get('opsknight_prepaging_lookups_total') ?? [],
    prePagingDeadlineMs()
  );
}
