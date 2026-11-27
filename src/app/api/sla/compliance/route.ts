import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { evaluateServiceObjective } from '@/lib/slo/evaluator';
import { legacyWindow, LEGACY_SLA_DEPRECATION_HEADERS } from '@/lib/slo/http';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { jsonError, jsonOk } from '@/lib/api-response';

/** @deprecated Use /api/v1/service-objectives/:id/evaluate. */
export const dynamic = 'force-dynamic';

/** Evaluations each run several queries; the database pool must stay free for other requests. */
const EVALUATION_CONCURRENCY = 5;

export async function GET(_request: NextRequest) {
  addOperationalMetric('opsknight_legacy_sla_api_requests_total', 1, {
    method: 'GET',
    endpoint_family: 'compliance',
  });
  try {
    return await compliance();
  } catch (error) {
    // Authorization denials keep their 401/403 instead of surfacing as a 500.
    return jsonError(error);
  }
}

async function compliance() {
  const actor = await getCurrentAuthorizationActor();
  const objectives = await prisma.serviceObjective.findMany({
    where: {
      activeTo: null,
      ...serviceObjectiveReadWhere(actor),
    },
    include: { service: { select: { id: true, name: true } } },
    orderBy: { activeFrom: 'desc' },
  });
  const toDefinition = async (objective: (typeof objectives)[number]) => {
    const evaluation = await evaluateServiceObjective({ actor, objective });
    return {
      definitionId: objective.lineageId,
      name: objective.name,
      serviceId: objective.serviceId,
      serviceName: objective.service?.name ?? 'Global',
      metricType: objective.metricType,
      target: objective.target,
      window: legacyWindow(objective.windowType, objective.windowValue),
      currentValue: evaluation.value,
      breached: evaluation.breached,
      dataState: evaluation.dataState.toLowerCase(),
      trend: 'stable' as const,
      totalIncidents: evaluation.sampleCount,
      activeIncidents: null,
      lastUpdated: evaluation.periodEnd.toISOString(),
    };
  };
  // One iterator shared by the workers hands each objective to exactly one of them.
  const queue = objectives.values();
  const evaluated = new Map<string, Awaited<ReturnType<typeof toDefinition>>>();
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(EVALUATION_CONCURRENCY, objectives.length) }, async () => {
      for (const objective of queue) {
        if (failed) return;
        try {
          evaluated.set(objective.lineageId, await toDefinition(objective));
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    })
  );
  const definitions = objectives.map(objective => evaluated.get(objective.lineageId)!);
  const available = definitions.filter(item => item.dataState === 'available');
  const percentages = available
    .filter(item => item.metricType === 'UPTIME' || item.metricType === 'AVAILABILITY')
    .map(item => item.currentValue)
    .filter((value): value is number => value !== null);
  const avgCompliance = percentages.length
    ? percentages.reduce((total, value) => total + value, 0) / percentages.length
    : null;
  return jsonOk(
    {
      definitions,
      summary: {
        total: definitions.length,
        available: available.length,
        unavailable: definitions.filter(item => item.dataState === 'unavailable').length,
        noData: definitions.filter(item => item.dataState === 'no_data').length,
        healthy: available.filter(item => item.breached === false).length,
        breached: available.filter(item => item.breached === true).length,
        avgCompliance: avgCompliance === null ? null : Math.round(avgCompliance * 100) / 100,
      },
      generatedAt: new Date().toISOString(),
    },
    200,
    LEGACY_SLA_DEPRECATION_HEADERS
  );
}
