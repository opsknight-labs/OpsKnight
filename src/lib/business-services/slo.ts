/** Pure SLO maths for business services: severity-weighted downtime and the error budget. */

export const SLO_WINDOW_DAYS = [7, 30, 90] as const;
export type BurnState = 'OK' | 'AT_RISK' | 'BREACHED';
type Interval = { start: number; end: number };
type Bounds = { from: number; to: number };

/** Share of a minute that counts as downtime per incident urgency (DEGRADED/PARTIAL/MAJOR). */
export const URGENCY_DOWNTIME_WEIGHT = { LOW: 0.25, MEDIUM: 0.5, HIGH: 1 } as const;

function unionMs(intervals: readonly Interval[], { from, to }: Bounds): number {
  let total = 0;
  let end = from;
  const clipped = intervals
    .map(i => ({ start: Math.max(i.start, from), end: Math.min(i.end, to) }))
    .filter(i => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  for (const i of clipped) {
    if (i.end <= end) continue;
    total += i.end - Math.max(i.start, end);
    end = i.end;
  }
  return total;
}

/**
 * Severity-weighted downtime with planned maintenance removed. Overlaps take the heaviest weight:
 * with levels 0.25 < 0.5 < 1 the weighted sum is the union at each level times the weight step.
 * Returns the downtime and the denominator (window length minus maintenance), both in ms.
 */
export function weightedDowntime(
  impacts: ReadonlyArray<Interval & { weight: number }>,
  maintenance: readonly Interval[],
  bounds: Bounds
): { downtimeMs: number; windowMs: number } {
  const maintenanceMs = unionMs(maintenance, bounds);
  const levels = [...new Set(impacts.map(i => i.weight))].sort((a, b) => a - b);
  let downtimeMs = 0;
  let previous = 0;
  for (const level of levels) {
    const active = impacts.filter(i => i.weight >= level);
    // Union with maintenance, minus maintenance itself: only impact outside the window counts.
    downtimeMs +=
      (level - previous) * (unionMs([...active, ...maintenance], bounds) - maintenanceMs);
    previous = level;
  }
  return { downtimeMs, windowMs: Math.max(bounds.to - bounds.from - maintenanceMs, 0) };
}

export type ErrorBudget = {
  allowedMinutes: number;
  consumedMinutes: number;
  /** Can go negative once breached. */
  remainingPercent: number;
  burnState: BurnState;
};

/** Below this share of the budget left the service is AT_RISK. */
export const AT_RISK_REMAINING_PERCENT = 25;

export function computeErrorBudget(input: {
  targetPercent: number;
  windowDays: number;
  downtimeMinutes: number;
}): ErrorBudget {
  const allowedMinutes = input.windowDays * 24 * 60 * (1 - input.targetPercent / 100);
  const consumedMinutes = Math.max(input.downtimeMinutes, 0);
  const remainingPercent =
    allowedMinutes > 0
      ? (1 - consumedMinutes / allowedMinutes) * 100
      : consumedMinutes > 0
        ? -100
        : 100;
  return {
    allowedMinutes,
    consumedMinutes,
    remainingPercent,
    burnState:
      remainingPercent <= 0
        ? 'BREACHED'
        : remainingPercent < AT_RISK_REMAINING_PERCENT
          ? 'AT_RISK'
          : 'OK',
  };
}
