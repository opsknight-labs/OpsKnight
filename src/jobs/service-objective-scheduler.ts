import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { evaluateServiceObjective } from '@/lib/slo/evaluator';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const SYSTEM_ACTOR: AuthorizationActor = {
  id: 'system:service-objective-scheduler',
  role: 'ADMIN',
  status: 'ACTIVE',
  teamIds: [],
};

/** Materializes metric-neutral daily SLO history using the canonical evaluator. */
export async function processServiceObjectiveSnapshots(now: Date = new Date()) {
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const periodStart = new Date(periodEnd.getTime() - 86_400_000);
  const objectives = await prisma.serviceObjective.findMany({
    where: {
      activeFrom: { lt: periodEnd },
      OR: [{ activeTo: null }, { activeTo: { gte: periodStart } }],
    },
  });

  let processed = 0;
  for (const objective of objectives) {
    try {
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
      logger.error('[SLO] Failed to materialize service-objective snapshot', {
        objectiveId: objective.id,
        error,
      });
    }
  }
  return { processed, total: objectives.length, periodStart, periodEnd };
}
