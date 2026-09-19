import 'server-only';

import { calculateActorMultiServiceUptime, calculateActorSLAMetrics } from '@/lib/actor-metrics';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { ServiceObjectiveEvaluation, ServiceObjectiveEvaluationInput } from './types';

const DAY_MS = 86_400_000;

export function objectiveWindowDays(
  windowType: ServiceObjectiveEvaluationInput['windowType'],
  windowValue: number | null
): number {
  switch (windowType) {
    case 'SEVEN_DAYS':
      return 7;
    case 'THIRTY_DAYS':
      return 30;
    case 'NINETY_DAYS':
    case 'QUARTERLY':
      return 90;
    case 'YEARLY':
      return 365;
    case 'ROLLING_DAYS':
      return windowValue && windowValue > 0 ? windowValue : 30;
  }
}

export function objectiveIsCompliant(
  value: number | null,
  target: number,
  comparator: ServiceObjectiveEvaluationInput['comparator']
): boolean | null {
  if (value === null || !Number.isFinite(value)) return null;
  return comparator === 'GREATER_THAN_OR_EQUAL' ? value >= target : value <= target;
}

/** The single evaluation boundary used by APIs, jobs, reports, and exports. */
export async function evaluateServiceObjective({
  actor,
  objective,
  start,
  end,
}: {
  actor: AuthorizationActor;
  objective: ServiceObjectiveEvaluationInput;
  start?: Date;
  end?: Date;
}): Promise<ServiceObjectiveEvaluation> {
  const periodEnd = end ?? new Date();
  const periodStart =
    start ??
    new Date(
      periodEnd.getTime() -
        objectiveWindowDays(objective.windowType, objective.windowValue) * DAY_MS
    );

  let value: number | null = null;
  let sampleCount: number | null = null;

  if (objective.metricType === 'UPTIME' || objective.metricType === 'AVAILABILITY') {
    if (objective.serviceId) {
      const uptime = await calculateActorMultiServiceUptime(
        actor,
        [objective.serviceId],
        periodStart,
        periodEnd
      );
      value = uptime[objective.serviceId] ?? null;
      if (value !== null) value = Math.max(0, Math.min(100, value));
    }
  } else {
    const metrics = await calculateActorSLAMetrics(actor, {
      serviceId: objective.serviceId ?? undefined,
      startDate: periodStart,
      endDate: periodEnd,
    });
    sampleCount = metrics.totalIncidents;
    if (objective.metricType === 'MTTA') value = metrics.mttd;
    if (objective.metricType === 'MTTR') value = metrics.mttr;
    if (objective.metricType === 'LATENCY_P99') value = metrics.avgLatencyP99;
    if (objective.metricType === 'ERROR_RATE') value = metrics.errorRate;
  }

  const compliant = objectiveIsCompliant(value, objective.target, objective.comparator);
  return {
    objectiveId: objective.lineageId,
    metric: objective.metricType,
    value,
    target: objective.target,
    comparator: objective.comparator,
    compliant,
    breached: compliant === null ? null : !compliant,
    sampleCount,
    periodStart,
    periodEnd,
    dataState: value === null ? 'NO_DATA' : 'AVAILABLE',
    definitionVersion: objective.version,
  };
}
