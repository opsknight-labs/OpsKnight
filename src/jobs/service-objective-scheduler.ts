import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { evaluateServiceObjective, objectiveWindowDays } from '@/lib/slo/evaluator';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { ObjectiveWindow } from '@/lib/slo/types';
import type { ServiceObjective } from '@prisma/client';
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

type MeasurementDefinition = Pick<
  ServiceObjective,
  'target' | 'comparator' | 'windowType' | 'windowValue'
>;

/**
 * When the current definition's measurement began. Editing only the name or description creates a
 * new immutable version but measures exactly the same thing, so the window runs back through every
 * earlier version with the same target, comparator and window instead of restarting at the edit.
 */
export function measurementStartedAt(
  current: MeasurementDefinition & Pick<ServiceObjective, 'version' | 'activeFrom'>,
  earlierVersions: ReadonlyArray<
    MeasurementDefinition & Pick<ServiceObjective, 'version' | 'activeFrom'>
  >
): Date {
  let startedAt = current.activeFrom;
  const sameBefore = [...earlierVersions]
    .filter(version => version.version < current.version)
    .sort((a, b) => b.version - a.version);
  for (const version of sameBefore) {
    if (
      version.target !== current.target ||
      version.comparator !== current.comparator ||
      version.windowType !== current.windowType ||
      version.windowValue !== current.windowValue
    )
      break;
    startedAt = version.activeFrom;
  }
  return startedAt;
}

/**
 * A window is partial while less than the objective's full period has been measured: the definition
 * (or, for uptime, the service) is younger than the window. Partial results are shown but never
 * decide a breach, because one short outage early in a window would read as a miss.
 */
export function isPartialObjectiveWindow(
  objective: { windowType: ObjectiveWindow; windowValue: number | null },
  period: { periodStart: Date; periodEnd: Date },
  serviceCreatedAt?: Date | null
): boolean {
  const measuredFrom =
    serviceCreatedAt && serviceCreatedAt > period.periodStart ? serviceCreatedAt : period.periodStart;
  return (
    period.periodEnd.getTime() - measuredFrom.getTime() <
    objectiveWindowDays(objective.windowType, objective.windowValue) * 86_400_000
  );
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
    include: { service: { select: { createdAt: true } } },
  });
  const lineageIds = [
    ...new Set(objectives.filter(objective => objective.version > 1).map(o => o.lineageId)),
  ];
  const earlierVersions = lineageIds.length
    ? await prisma.serviceObjective.findMany({
        where: { lineageId: { in: lineageIds } },
        select: {
          lineageId: true,
          version: true,
          target: true,
          comparator: true,
          windowType: true,
          windowValue: true,
          activeFrom: true,
        },
      })
    : [];

  let processed = 0;
  let failed = 0;
  for (const objective of objectives) {
    try {
      const period = getObjectiveSnapshotPeriod(
        {
          ...objective,
          activeFrom: measurementStartedAt(
            objective,
            earlierVersions.filter(version => version.lineageId === objective.lineageId)
          ),
        },
        dayEnd
      );
      if (!period) continue;
      const { periodStart, periodEnd } = period;
      const result = await evaluateServiceObjective({
        actor: SYSTEM_ACTOR,
        objective,
        start: periodStart,
        end: periodEnd,
      });
      const partial =
        result.dataState === 'AVAILABLE' &&
        isPartialObjectiveWindow(
          objective,
          period,
          objective.metricType === 'UPTIME' || objective.metricType === 'AVAILABILITY'
            ? objective.service?.createdAt
            : null
        );
      const outcome = {
        value: result.value,
        sampleCount: result.sampleCount === null ? null : BigInt(result.sampleCount),
        target: result.target,
        breached: partial ? null : result.breached,
        dataState: partial ? ('PARTIAL' as const) : result.dataState,
        definitionVersion: result.definitionVersion,
      };
      await prisma.serviceObjectiveSnapshot.upsert({
        where: {
          objectiveId_periodStart_periodEnd: {
            objectiveId: objective.id,
            periodStart,
            periodEnd,
          },
        },
        create: { objectiveId: objective.id, periodStart, periodEnd, ...outcome },
        update: outcome,
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
