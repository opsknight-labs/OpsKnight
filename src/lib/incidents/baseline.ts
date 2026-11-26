/**
 * "Usually resolved in ~45m": the service's own response baseline, from its recent resolved incidents, so a
 * responder can tell whether this one is running long. Medians, so one week-long outlier does not skew it.
 */

/** Fewer resolved incidents than this and a "usual" would be noise. */
export const BASELINE_MIN_SAMPLES = 3;

export type ServiceBaseline = {
  samples: number;
  resolveMs: number;
  ackMs: number | null;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // eslint-disable-next-line security/detect-object-injection -- index into an array just measured
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeBaseline(
  rows: Array<{ createdAt: Date; acknowledgedAt: Date | null; resolvedAt: Date | null }>
): ServiceBaseline | null {
  const resolve = rows
    .filter(r => r.resolvedAt)
    .map(r => r.resolvedAt!.getTime() - r.createdAt.getTime())
    .filter(ms => ms > 0);
  if (resolve.length < BASELINE_MIN_SAMPLES) return null;
  const ack = rows
    .filter(r => r.acknowledgedAt)
    .map(r => r.acknowledgedAt!.getTime() - r.createdAt.getTime())
    .filter(ms => ms >= 0);
  return {
    samples: resolve.length,
    resolveMs: median(resolve)!,
    ackMs: ack.length >= BASELINE_MIN_SAMPLES ? median(ack) : null,
  };
}

/** How this incident compares: null while it is within the usual time. */
export function runningLong(elapsedMs: number, baseline: ServiceBaseline | null): number | null {
  if (!baseline || baseline.resolveMs <= 0) return null;
  const ratio = elapsedMs / baseline.resolveMs;
  return ratio >= 2 ? Math.floor(ratio) : null;
}

/** "45m", "3h", "2d". */
export function shortDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export type BaselineLabel = { text: string; long: boolean; title: string };

/** The finished line for the Opened field, computed where reading the clock is fine (the server). */
export function baselineLabel(
  baseline: ServiceBaseline | null,
  createdAt: Date,
  resolvedAt: Date | null,
  now: number
): BaselineLabel | null {
  if (!baseline) return null;
  const long = resolvedAt ? null : runningLong(now - createdAt.getTime(), baseline);
  return {
    text: long
      ? `${long}× longer than usual (~${shortDuration(baseline.resolveMs)})`
      : `Usually resolved in ~${shortDuration(baseline.resolveMs)}`,
    long: Boolean(long),
    title: `Median of the last ${baseline.samples} resolved incidents on this service${
      baseline.ackMs ? `; usually acknowledged in ~${shortDuration(baseline.ackMs)}` : ''
    }`,
  };
}
