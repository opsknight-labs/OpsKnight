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
  if (!Number.isFinite(recent) || !Number.isFinite(baselineTotal) || recent < ANOMALY_MIN_INCIDENTS) return null;
  const baselineWeekly = Math.max(0, baselineTotal) / ANOMALY_BASELINE_WEEKS;
  const ratio = recent / Math.max(baselineWeekly, 1);
  if (ratio < ANOMALY_RATIO) return null;
  return { recent, baselineWeekly: Math.round(baselineWeekly * 10) / 10, ratio: Math.round(ratio * 10) / 10 };
}
