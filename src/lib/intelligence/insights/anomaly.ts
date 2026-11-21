export const ANOMALY_RECENT_DAYS = 7;
export const ANOMALY_BASELINE_WEEKS = 4;
export const ANOMALY_MIN_INCIDENTS = 5;
export const ANOMALY_RATIO = 3;

export interface RateAnomaly {
  recent: number;
  /** Mean incidents per week over the baseline weeks. */
  baselineWeekly: number;
  ratio: number;
}

/**
 * Flags a service whose incident count this week is far above its own recent norm. It needs both a
 * minimum absolute count and a multiple of the baseline, and a service with no history is compared to
 * a floor of one per week, so brand-new or very quiet services do not flap on a handful of incidents.
 * This is a flag for a person to look at, never an action.
 */
export function detectRateAnomaly(recent: number, baselineTotal: number): RateAnomaly | null {
  if (!Number.isFinite(recent) || !Number.isFinite(baselineTotal) || recent < ANOMALY_MIN_INCIDENTS)
    return null;
  const baselineWeekly = Math.max(0, baselineTotal) / ANOMALY_BASELINE_WEEKS;
  const ratio = recent / Math.max(baselineWeekly, 1);
  if (ratio < ANOMALY_RATIO) return null;
  return {
    recent,
    baselineWeekly: Math.round(baselineWeekly * 10) / 10,
    ratio: Math.round(ratio * 10) / 10,
  };
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2
    ? sorted[Math.floor(sorted.length / 2)]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

/** Compare the same weekday/hour slot across prior weeks, with a robust MAD threshold. */
export function detectSeasonalAnomaly(
  recent: number,
  baseline: readonly number[]
): RateAnomaly | null {
  if (
    !Number.isFinite(recent) ||
    recent < ANOMALY_MIN_INCIDENTS ||
    baseline.length < 4 ||
    baseline.some(value => !Number.isFinite(value) || value < 0)
  )
    return null;
  const center = median(baseline);
  const mad = median(baseline.map(value => Math.abs(value - center)));
  const threshold = center + Math.max(5, 3 * 1.4826 * mad);
  if (recent <= threshold || recent < Math.max(1, center) * 1.5) return null;
  return {
    recent,
    baselineWeekly: center,
    ratio: Math.round((recent / Math.max(center, 1)) * 10) / 10,
  };
}

/** At least three short resolved episodes reopening within ten minutes, for one service/dedup key. */
export function detectFlapping(
  episodes: readonly { createdAt: Date; resolvedAt: Date | null }[]
): { episodes: number } | null {
  const ordered = [...episodes].sort((a, b) => +a.createdAt - +b.createdAt);
  let longest = 0;
  let run = 0;
  let previousEnd: number | null = null;
  for (const episode of ordered) {
    const start = +episode.createdAt;
    const end = episode.resolvedAt ? +episode.resolvedAt : NaN;
    if (!Number.isFinite(end) || end < start || end - start > 10 * 60_000) {
      run = 0;
      previousEnd = null;
      continue;
    }
    run =
      previousEnd !== null && start >= previousEnd && start - previousEnd <= 10 * 60_000
        ? run + 1
        : 1;
    longest = Math.max(longest, run);
    previousEnd = end;
  }
  return longest >= 3 ? { episodes: longest } : null;
}
