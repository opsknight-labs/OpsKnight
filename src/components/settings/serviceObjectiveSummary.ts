import { SERVICE_OBJECTIVE_CONTRACT } from '@/lib/slo/contract';

/** Server-safe helpers shared by the service objectives page and its directory. */

export type ObjectiveHealth =
  | 'MEETING'
  | 'AT_RISK'
  | 'BREACHED'
  | 'NO_DATA'
  | 'UNAVAILABLE'
  | 'NOT_MEASURED'
  | 'RESTRICTED'
  | 'LEGACY';

export type ObjectiveSnapshot = {
  value: number | null;
  breached: boolean | null;
  dataState: string;
  periodEnd: Date;
};

/** Under this share of error budget left, a passing objective reads as "At risk". */
export const AT_RISK_BUDGET = 0.25;

const PERCENT_METRICS = ['UPTIME', 'AVAILABILITY'];

export function objectiveUnit(metricType: string): 'percent' | 'minutes' | null {
  return SERVICE_OBJECTIVE_CONTRACT.metrics.find(metric => metric.id === metricType)?.unit ?? null;
}

/**
 * Health from the latest scheduled snapshot. Error budget only exists for "at least N%"
 * targets below 100%: remaining = (attained − target) / (100 − target), clamped to 0–1.
 */
export function summarizeObjective(objective: {
  metricType: string;
  target: number;
  comparator: string;
  snapshot: ObjectiveSnapshot | null;
  canReadHistory: boolean;
}): { health: ObjectiveHealth; value: number | null; budgetRemaining: number | null } {
  const { snapshot } = objective;
  const value = snapshot?.dataState === 'AVAILABLE' ? snapshot.value : null;
  const budgetRemaining =
    value !== null &&
    PERCENT_METRICS.includes(objective.metricType) &&
    objective.comparator === 'GREATER_THAN_OR_EQUAL' &&
    objective.target < 100
      ? Math.min(1, Math.max(0, (value - objective.target) / (100 - objective.target)))
      : null;
  const health: ObjectiveHealth = !objectiveUnit(objective.metricType)
    ? 'LEGACY'
    : !objective.canReadHistory
      ? 'RESTRICTED'
      : !snapshot
        ? 'NOT_MEASURED'
        : snapshot.dataState === 'NO_DATA'
          ? 'NO_DATA'
          : snapshot.dataState !== 'AVAILABLE'
            ? 'UNAVAILABLE'
            : snapshot.breached
              ? 'BREACHED'
              : budgetRemaining !== null && budgetRemaining < AT_RISK_BUDGET
                ? 'AT_RISK'
                : 'MEETING';
  return { health, value, budgetRemaining };
}

export function formatObjectiveWindow(windowType: string, windowValue: number | null): string {
  switch (windowType) {
    case 'SEVEN_DAYS':
      return '7 days';
    case 'THIRTY_DAYS':
      return '30 days';
    case 'NINETY_DAYS':
      return '90 days';
    case 'QUARTERLY':
      return 'Quarterly (90 days)';
    case 'YEARLY':
      return 'Yearly (365 days)';
    case 'ROLLING_DAYS':
      return windowValue ? `Rolling ${windowValue} days` : 'Rolling days';
    default:
      return windowType.replaceAll('_', ' ');
  }
}

export function formatObjectiveTarget(metricType: string, comparator: string, target: number) {
  const unit = objectiveUnit(metricType);
  const verb = comparator === 'GREATER_THAN_OR_EQUAL' ? 'At least' : 'At most';
  return `${verb} ${target}${unit === 'percent' ? '%' : unit === 'minutes' ? ' min' : ''}`;
}

export function formatObjectiveValue(metricType: string, value: number | null): string | null {
  if (value === null) return null;
  const unit = objectiveUnit(metricType);
  return unit === 'percent'
    ? `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })}%`
    : `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} min`;
}
