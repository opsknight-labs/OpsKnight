import 'server-only';
import { AppError } from '@/lib/errors';
import { getQueryDateBounds } from '@/lib/retention-policy';
import { METRIC_ACCUMULATOR } from '@/lib/metrics/domain/accumulator';

import { calculateActorMultiServiceUptime, calculateActorSLAMetrics } from '@/lib/actor-metrics';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
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

/** Compare additive elapsed time against the exact decimal target, before display rounding. */
export function objectiveElapsedIsCompliant(
  sumMs: bigint,
  count: bigint,
  target: number,
  comparator: ServiceObjectiveEvaluationInput['comparator']
): boolean | null {
  if (count <= BigInt(0) || sumMs < BigInt(0) || !Number.isFinite(target) || target < 0)
    return null;
  const [coefficient, exponentText] = target.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const exponent = Number(exponentText ?? 0) - fraction.length;
  const numerator =
    BigInt(whole + fraction) * (exponent >= 0 ? BigInt(10) ** BigInt(exponent) : BigInt(1));
  const denominator = exponent < 0 ? BigInt(10) ** BigInt(-exponent) : BigInt(1);
  const measured = sumMs * denominator;
  const threshold = numerator * count * BigInt(60000);
  return comparator === 'GREATER_THAN_OR_EQUAL' ? measured >= threshold : measured <= threshold;
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
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_EVALUATE });
  if (!decision.allowed) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  // The objective evaluation scope grants aggregate access using the same role/team
  // filters. It does not grant access to the raw incident or service APIs.
  const measurementActor = { ...actor, apiKey: undefined };
  const periodEnd = end ?? new Date();
  const periodStart =
    start ??
    new Date(
      periodEnd.getTime() -
        objectiveWindowDays(objective.windowType, objective.windowValue) * DAY_MS
    );

  if (
    !Number.isFinite(periodStart.getTime()) ||
    !Number.isFinite(periodEnd.getTime()) ||
    periodStart >= periodEnd ||
    periodEnd.getTime() > Date.now() + 1000 ||
    periodEnd.getTime() - periodStart.getTime() > 3650 * DAY_MS
  )
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage:
        'Evaluation requires an ordered, finite, non-future period of at most 3650 days.',
    });
  let unavailable = !['UPTIME', 'AVAILABILITY', 'MTTA', 'MTTR'].includes(objective.metricType);
  let effectiveStart = periodStart;
  let effectiveEnd = periodEnd;
  let sampleCountExact: string | null = null;
  let elapsedSumMs: string | null = null;
  let value: number | null = null;
  let sampleCount: number | null = null;

  if (objective.metricType === 'UPTIME' || objective.metricType === 'AVAILABILITY') {
    const bounds = await getQueryDateBounds(periodStart, periodEnd, 'incident');
    effectiveStart = bounds.start;
    effectiveEnd = bounds.end;
    unavailable = bounds.isClipped;
    if (objective.serviceId && !unavailable) {
      const uptime = await calculateActorMultiServiceUptime(
        measurementActor,
        [objective.serviceId],
        periodStart,
        periodEnd
      );
      value = uptime[objective.serviceId] ?? null;
      if (value !== null) value = Math.max(0, Math.min(100, value));
    }
  } else if (!unavailable) {
    const metrics = await calculateActorSLAMetrics(measurementActor, {
      serviceId: objective.serviceId ?? undefined,
      startDate: periodStart,
      endDate: periodEnd,
    });
    effectiveStart = metrics.effectiveStart;
    effectiveEnd = metrics.effectiveEnd;
    unavailable = metrics.isClipped;
    // A module-owned symbol selects canonical additive state, never user-controlled input.
    // eslint-disable-next-line security/detect-object-injection
    const accumulator = metrics[METRIC_ACCUMULATOR];
    const count = objective.metricType === 'MTTA' ? accumulator?.mttaCount : accumulator?.mttrCount;
    const sum = objective.metricType === 'MTTA' ? accumulator?.mttaSumMs : accumulator?.mttrSumMs;
    sampleCountExact = count?.toString() ?? null;
    elapsedSumMs = sum?.toString() ?? null;
    sampleCount =
      count !== undefined && count <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : null;
    if (count === undefined || sum === undefined) unavailable = true;
    else value = count > BigInt(0) ? Number(sum) / Number(count) / 60000 : null;
  }

  if (unavailable) value = null;
  const compliant =
    value === null
      ? null
      : elapsedSumMs !== null && sampleCountExact !== null
        ? objectiveElapsedIsCompliant(
            BigInt(elapsedSumMs),
            BigInt(sampleCountExact),
            objective.target,
            objective.comparator
          )
        : objectiveIsCompliant(value, objective.target, objective.comparator);
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
    dataState: unavailable ? 'UNAVAILABLE' : value === null ? 'NO_DATA' : 'AVAILABLE',
    coverage: { effectiveStart, effectiveEnd, complete: !unavailable },
    sampleCountExact,
    elapsedSumMs,
    definitionVersion: objective.version,
  };
}
