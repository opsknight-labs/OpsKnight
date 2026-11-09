import 'server-only';
import prisma from '@/lib/prisma';

/**
 * Error-budget burn rate for a service's availability objectives, over the two classic windows. A burn
 * rate of 1 consumes exactly the budget over the objective's period; 14.4 over one hour or 6 over six
 * hours are the usual fast- and slow-burn pages. Downtime is the time the service had at least one open
 * incident (intervals merged), which is the same notion the uptime objective measures.
 */

export const BURN_WINDOWS_MINUTES = { fast: 60, slow: 360 } as const;
export const FAST_BURN_CRITICAL = 14.4;
export const SLOW_BURN_CRITICAL = 6;
export const BURN_WARNING_FRACTION = 0.5;
const MAX_INCIDENTS = 500;

export interface Interval {
  start: number;
  end: number;
}

/** Minutes covered by the union of `intervals`, clipped to [windowStart, windowEnd]. */
export function mergedDowntimeMinutes(
  intervals: readonly Interval[],
  windowStart: number,
  windowEnd: number
): number {
  const clipped = intervals
    .map(interval => ({
      start: Math.max(interval.start, windowStart),
      end: Math.min(interval.end, windowEnd),
    }))
    .filter(interval => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let current: Interval | null = null;
  for (const interval of clipped) {
    if (current && interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
    } else {
      if (current) total += current.end - current.start;
      current = { ...interval };
    }
  }
  if (current) total += current.end - current.start;
  return total / 60_000;
}

/** Burn rate = budget consumed in the window divided by the budget the window is allowed. */
export function burnRate(
  downtimeMinutes: number,
  windowMinutes: number,
  targetPercent: number
): number {
  const budget = Math.max(0.0001, 1 - Math.min(99.9999, Math.max(0, targetPercent)) / 100);
  const unavailable = Math.max(0, Math.min(1, downtimeMinutes / windowMinutes));
  return Math.round((unavailable / budget) * 100) / 100;
}

export type BurnSeverity = 'none' | 'warning' | 'critical';

export function classifyBurn(fast: number, slow: number): BurnSeverity {
  if (fast >= FAST_BURN_CRITICAL || slow >= SLOW_BURN_CRITICAL) return 'critical';
  if (
    fast >= FAST_BURN_CRITICAL * BURN_WARNING_FRACTION ||
    slow >= SLOW_BURN_CRITICAL * BURN_WARNING_FRACTION
  )
    return 'warning';
  return 'none';
}

export interface ObjectiveBurn {
  objectiveId: string;
  name: string;
  targetPercent: number;
  fastBurn: number;
  slowBurn: number;
  severity: BurnSeverity;
  /**
   * The objective's whole error budget in minutes over its window; null when the target allows no downtime.
   * Optional so existing constructors of this type stay valid; getSloBurn always sets it.
   */
  budgetMinutes?: number | null;
}

/** Days in an objective window (mirrors the evaluator); rolling windows default to 30 days. */
export function objectiveBudgetMinutes(
  targetPercent: number,
  windowType: string,
  windowValue: number | null
): number | null {
  const days =
    windowType === 'SEVEN_DAYS'
      ? 7
      : windowType === 'NINETY_DAYS' || windowType === 'QUARTERLY'
        ? 90
        : windowType === 'YEARLY'
          ? 365
          : windowType === 'ROLLING_DAYS' && windowValue && windowValue > 0
            ? windowValue
            : 30;
  const budget = (1 - Math.min(100, Math.max(0, targetPercent)) / 100) * days * 1440;
  return budget > 0 ? Math.round(budget * 10) / 10 : null;
}

export interface ServiceBurn {
  serviceId: string;
  downtimeMinutes: { fast: number; slow: number };
  objectives: ObjectiveBurn[];
  /** True when any objective is at warning or critical burn. */
  burning: boolean;
  severity: BurnSeverity;
}

/**
 * Burn for every active availability/uptime objective of a service. Returns null when the service has
 * no such objective, so callers can tell "no SLO" from "not burning". Bounded: at most MAX_INCIDENTS
 * incidents overlapping the six-hour window are read.
 */
export async function getSloBurn(
  serviceId: string,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<ServiceBurn | null> {
  const objectives = await client.serviceObjective.findMany({
    where: {
      serviceId,
      metricType: { in: ['UPTIME', 'AVAILABILITY'] },
      activeFrom: { lte: now },
      OR: [{ activeTo: null }, { activeTo: { gt: now } }],
    },
    orderBy: { name: 'asc' },
    take: 20,
    select: { lineageId: true, name: true, target: true, windowType: true, windowValue: true },
  });
  if (objectives.length === 0) return null;
  const end = now.getTime();
  const slowStart = end - BURN_WINDOWS_MINUTES.slow * 60_000;
  const fastStart = end - BURN_WINDOWS_MINUTES.fast * 60_000;
  const incidents = await client.incident.findMany({
    where: {
      serviceId,
      createdAt: { lte: now },
      OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(slowStart) } }],
      status: { not: 'SUPPRESSED' },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_INCIDENTS,
    select: { createdAt: true, resolvedAt: true },
  });
  const intervals: Interval[] = incidents.map(incident => ({
    start: incident.createdAt.getTime(),
    end: incident.resolvedAt?.getTime() ?? end,
  }));
  const downtime = {
    fast: mergedDowntimeMinutes(intervals, fastStart, end),
    slow: mergedDowntimeMinutes(intervals, slowStart, end),
  };
  const rows: ObjectiveBurn[] = objectives.map(objective => {
    const fastBurn = burnRate(downtime.fast, BURN_WINDOWS_MINUTES.fast, objective.target);
    const slowBurn = burnRate(downtime.slow, BURN_WINDOWS_MINUTES.slow, objective.target);
    return {
      objectiveId: objective.lineageId,
      name: objective.name,
      targetPercent: objective.target,
      fastBurn,
      slowBurn,
      severity: classifyBurn(fastBurn, slowBurn),
      budgetMinutes: objectiveBudgetMinutes(
        objective.target,
        objective.windowType,
        objective.windowValue
      ),
    };
  });
  const severity: BurnSeverity = rows.some(row => row.severity === 'critical')
    ? 'critical'
    : rows.some(row => row.severity === 'warning')
      ? 'warning'
      : 'none';
  return {
    serviceId,
    downtimeMinutes: {
      fast: Math.round(downtime.fast * 10) / 10,
      slow: Math.round(downtime.slow * 10) / 10,
    },
    objectives: rows,
    burning: severity !== 'none',
    severity,
  };
}

/** Among candidate services, the ones burning fastest first; a tie-break helper for grouping anchors. */
export function rankByBurn(burns: ReadonlyArray<ServiceBurn | null>): string[] {
  const order: Record<BurnSeverity, number> = { critical: 2, warning: 1, none: 0 };
  return burns
    .filter((burn): burn is ServiceBurn => burn !== null)
    .sort(
      (a, b) =>
        order[b.severity] - order[a.severity] ||
        Math.max(...b.objectives.map(o => o.fastBurn), 0) -
          Math.max(...a.objectives.map(o => o.fastBurn), 0)
    )
    .map(burn => burn.serviceId);
}
