/**
 * Alert activity for the incident Timeline graph: when the alerts that were deduplicated into this incident
 * arrived (as per-minute counts, aggregated in SQL), and the dedup facts behind them. Pure and serialisable;
 * the server read lives in alert-activity-server.ts so this file stays safe for the client graph.
 */

export type AlertActivity = {
  /** Every alert on the incident. */
  total: number;
  /** Alerts per minute, oldest first: at most one row per minute the incident received alerts. */
  buckets: Array<{ at: string; count: number }>;
  /** Alerts still in TRIGGERED state. */
  firing: number;
  /** Alert count per severity label, most frequent first. */
  severities: Array<{ severity: string; count: number }>;
  /** Distinct alert fingerprints; 0 when the source sends none. */
  fingerprints: number;
  firstAt: string | null;
  lastAt: string | null;
  dedupKey: string | null;
};

const BUCKET_MINUTES = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440];

/** The smallest readable bucket that keeps the graph at or under `maxBuckets` bars. */
export function pickBucketMinutes(spanMs: number, maxBuckets = 72): number {
  const spanMinutes = Math.max(1, spanMs / 60_000);
  return BUCKET_MINUTES.find(m => spanMinutes / m <= maxBuckets) ?? 1440;
}

/** Counts per bucket from `startMs` (inclusive) to `endMs`; points outside the range are ignored. */
export function bucketCounts(
  points: Array<{ ms: number; count: number }>,
  startMs: number,
  endMs: number,
  bucketMinutes: number
): number[] {
  const size = bucketMinutes * 60_000;
  const buckets = new Array<number>(Math.max(1, Math.ceil((endMs - startMs) / size))).fill(0);
  for (const { ms, count } of points) {
    if (ms < startMs || ms > endMs) continue;
    buckets[Math.min(buckets.length - 1, Math.floor((ms - startMs) / size))] += count;
  }
  return buckets;
}
