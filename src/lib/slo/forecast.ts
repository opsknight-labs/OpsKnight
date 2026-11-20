import { mergedDowntimeMinutes, objectiveBudgetMinutes, type Interval } from './burn';

/**
 * Error-budget forecast for an availability objective: what is left of the budget over the objective's window
 * and how many days it lasts at the burn of the last seven days. Deterministic; downtime is the same merged
 * open-incident time as `burn.ts`.
 */

export const FORECAST_BURN_DAYS = 7;
export const FORECAST_TOP_INCIDENTS = 5;
const DAY_MS = 86_400_000;
const round1 = (value: number) => Math.round(value * 10) / 10;

export interface BudgetForecast {
  windowDays: number;
  budgetMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  /** Downtime minutes per day over the last FORECAST_BURN_DAYS. */
  burnPerDay: number;
  /** Days until the budget runs out at that burn; null when not burning, 0 when already spent. */
  daysLeft: number | null;
  /** Incidents with the most downtime inside the window (overlaps count for each), largest first. */
  topIncidents: Array<{ incidentId: string; minutes: number }>;
}

export function forecastErrorBudget(
  objective: { target: number; windowType: string; windowValue: number | null },
  incidents: ReadonlyArray<{ id: string; createdAt: Date; resolvedAt: Date | null }>,
  now: Date
): BudgetForecast | null {
  const budgetMinutes = objectiveBudgetMinutes(
    objective.target,
    objective.windowType,
    objective.windowValue
  );
  if (!budgetMinutes) return null;
  // A 0% target makes the whole window the budget: the window length in minutes.
  const windowDays = objectiveBudgetMinutes(0, objective.windowType, objective.windowValue)! / 1440;
  const end = now.getTime();
  const windowStart = end - windowDays * DAY_MS;
  const intervals: Array<Interval & { id: string }> = incidents.map(incident => ({
    id: incident.id,
    start: incident.createdAt.getTime(),
    end: incident.resolvedAt?.getTime() ?? end,
  }));
  const consumedMinutes = round1(mergedDowntimeMinutes(intervals, windowStart, end));
  const recent = mergedDowntimeMinutes(
    intervals,
    end - Math.min(FORECAST_BURN_DAYS, windowDays) * DAY_MS,
    end
  );
  const burnPerDay = round1(recent / Math.min(FORECAST_BURN_DAYS, windowDays));
  const remainingMinutes = round1(Math.max(0, budgetMinutes - consumedMinutes));
  const topIncidents = intervals
    .map(interval => ({
      incidentId: interval.id,
      minutes: round1(mergedDowntimeMinutes([interval], windowStart, end)),
    }))
    .filter(item => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.incidentId.localeCompare(b.incidentId))
    .slice(0, FORECAST_TOP_INCIDENTS);
  return {
    windowDays,
    budgetMinutes,
    consumedMinutes,
    remainingMinutes,
    burnPerDay,
    daysLeft:
      remainingMinutes === 0 ? 0 : burnPerDay > 0 ? round1(remainingMinutes / burnPerDay) : null,
    topIncidents,
  };
}
