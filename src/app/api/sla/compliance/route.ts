import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { evaluateServiceObjective } from '@/lib/slo/evaluator';
import { legacyWindow, LEGACY_SLA_DEPRECATION_HEADERS } from '@/lib/slo/http';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { jsonOk } from '@/lib/api-response';

/** @deprecated Use /api/v1/service-objectives/:id/evaluate. */
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  addOperationalMetric('opsknight_legacy_sla_api_requests_total', 1, {
    method: 'GET',
    endpoint_family: 'compliance',
  });
  const actor = await getCurrentAuthorizationActor();
  const objectives = await prisma.serviceObjective.findMany({
    where: {
      activeTo: null,
      OR: [{ serviceId: null }, { service: serviceReadWhere(actor) }],
    },
    include: { service: { select: { id: true, name: true } } },
    orderBy: { activeFrom: 'desc' },
  });
  const definitions = await Promise.all(
    objectives.map(async objective => {
      const evaluation = await evaluateServiceObjective({ actor, objective });
      return {
        definitionId: objective.id,
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
    })
  );
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
