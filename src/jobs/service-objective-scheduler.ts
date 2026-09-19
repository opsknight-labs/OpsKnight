import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { evaluateServiceObjective, objectiveWindowDays } from '@/lib/slo/evaluator';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { ObjectiveWindow } from '@/lib/slo/types';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';

const SYSTEM_ACTOR: AuthorizationActor = {
  id: 'system:service-objective-scheduler',
  role: 'ADMIN',
  status: 'ACTIVE',
  teamIds: [],
};

export function getObjectiveSnapshotPeriod(
  objective: {
    windowType: ObjectiveWindow;
    windowValue: number | null;
    activeFrom: Date;
    activeTo: Date | null;
  },
  dayEnd: Date
): { periodStart: Date; periodEnd: Date } | null {
  const periodEnd = objective.activeTo && objective.activeTo < dayEnd ? objective.activeTo : dayEnd;
  const configuredStart = new Date(
    periodEnd.getTime() -
      objectiveWindowDays(objective.windowType, objective.windowValue) * 86_400_000
  );
  const periodStart = objective.activeFrom > configuredStart ? objective.activeFrom : configuredStart;
  return periodStart < periodEnd ? { periodStart, periodEnd } : null;
}

/** Materializes metric-neutral daily SLO history using the canonical evaluator. */
export async function processServiceObjectiveSnapshots(now: Date = new Date()) {
  const startedAt = Date.now();
  const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayStart = new Date(dayEnd.getTime() - 86_400_000);
  const objectives = await prisma.serviceObjective.findMany({
    where: {
      activeFrom: { lt: dayEnd },
      OR: [{ activeTo: null }, { activeTo: { gt: dayStart } }],
    },
  });

  let processed = 0;
  let failed = 0;
  for (const objective of objectives) {
    try {
      const period = getObjectiveSnapshotPeriod(objective, dayEnd);
      if (!period) continue;
      const { periodStart, periodEnd } = period;
      const result = await evaluateServiceObjective({
        actor: SYSTEM_ACTOR,
        objective,
        start: periodStart,
        end: periodEnd,
      });
      await prisma.serviceObjectiveSnapshot.upsert({
        where: {
          objectiveId_periodStart_periodEnd: {
            objectiveId: objective.id,
            periodStart,
            periodEnd,
          },
        },
        create: {
          objectiveId: objective.id,
          periodStart,
          periodEnd,
          value: result.value,
          sampleCount: result.sampleCount === null ? null : BigInt(result.sampleCount),
          target: result.target,
          breached: result.breached,
          dataState: result.dataState,
          definitionVersion: result.definitionVersion,
        },
        update: {
          value: result.value,
          sampleCount: result.sampleCount === null ? null : BigInt(result.sampleCount),
          target: result.target,
          breached: result.breached,
          dataState: result.dataState,
          definitionVersion: result.definitionVersion,
        },
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      logger.error('[SLO] Failed to materialize service-objective snapshot', {
        objectiveId: objective.id,
        error,
      });
    }
  }
  const durationMs = Date.now() - startedAt;
  addOperationalMetric('opsknight_service_objective_snapshot_runs_total', 1, {
    result: failed === 0 ? 'success' : 'partial',
  });
  observeOperationalHistogram(
    'opsknight_service_objective_snapshot_duration_seconds',
    durationMs / 1000
  );
  return {
    processed,
    failed,
    total: objectives.length,
    dayEnd,
    durationMs,
  };
}
