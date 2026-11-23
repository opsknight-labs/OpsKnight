/**
 * Alert activity for the incident Timeline graph: when the alerts that were deduplicated into this incident
 * arrived, and the dedup facts behind them. Pure and serialisable so the client graph can bucket it.
 */

/** Most alert timestamps the page sends to the graph; the counts stay exact beyond it. */
export const ALERT_ACTIVITY_MAX_TIMES = 2000;

export type AlertActivity = {
  /** Every alert on the incident, including ones past the timestamp cap. */
  total: number;
  /** ISO timestamps, oldest first, at most ALERT_ACTIVITY_MAX_TIMES. */
  times: string[];
  truncated: boolean;
  /** Alerts still in TRIGGERED state (among the ones read). */
  firing: number;
  /** Alert count per severity label (among the ones read), most frequent first. */
  severities: Array<{ severity: string; count: number }>;
  /** Distinct alert fingerprints (among the ones read); 0 when the source sends none. */
  fingerprints: number;
  firstAt: string | null;
  lastAt: string | null;
  dedupKey: string | null;
};

type AlertRow = {
  createdAt: Date;
  status: string;
  severity: string | null;
  fingerprintHash: string | null;
};

export function summarizeAlertActivity(
  rows: AlertRow[],
  total: number,
  dedupKey: string | null
): AlertActivity {
  const severityCounts = new Map<string, number>();
  const fingerprints = new Set<string>();
  let firing = 0;
  for (const row of rows) {
    if (row.status === 'TRIGGERED') firing += 1;
    const severity = row.severity?.trim().toLowerCase() || 'unspecified';
    severityCounts.set(severity, (severityCounts.get(severity) ?? 0) + 1);
    if (row.fingerprintHash) fingerprints.add(row.fingerprintHash);
  }
  return {
    total: Math.max(total, rows.length),
    times: rows.map(row => row.createdAt.toISOString()),
    truncated: total > rows.length,
    firing,
    severities: [...severityCounts]
      .map(([severity, count]) => ({ severity, count }))
      .sort((a, b) => b.count - a.count),
    fingerprints: fingerprints.size,
    firstAt: rows[0]?.createdAt.toISOString() ?? null,
    lastAt: rows.at(-1)?.createdAt.toISOString() ?? null,
    dedupKey,
  };
}

const BUCKET_MINUTES = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440];

/** The smallest readable bucket that keeps the graph at or under `maxBuckets` bars. */
export function pickBucketMinutes(spanMs: number, maxBuckets = 72): number {
  const spanMinutes = Math.max(1, spanMs / 60_000);
  return BUCKET_MINUTES.find(m => spanMinutes / m <= maxBuckets) ?? 1440;
}

/** Counts per bucket from `startMs` (inclusive) to `endMs`; times outside the range are ignored. */
export function bucketTimes(
  timesMs: number[],
  startMs: number,
  endMs: number,
  bucketMinutes: number
): number[] {
  const size = bucketMinutes * 60_000;
  const buckets = new Array<number>(Math.max(1, Math.ceil((endMs - startMs) / size))).fill(0);
  for (const t of timesMs) {
    if (t < startMs || t > endMs) continue;
    buckets[Math.min(buckets.length - 1, Math.floor((t - startMs) / size))] += 1;
  }
  return buckets;
}
