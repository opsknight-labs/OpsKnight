import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { LEGACY_SLA_DEPRECATION_HEADERS, legacySlaGone, legacyWindow } from '@/lib/slo/http';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';

export async function GET(request: NextRequest) {
  addOperationalMetric('opsknight_legacy_sla_api_requests_total', 1, {
    method: 'GET',
    endpoint_family: 'definitions',
  });
  const actor = await getCurrentAuthorizationActor();
  const serviceId = new URL(request.url).searchParams.get('serviceId');
  const [legacyDefinitions, objectives] = await Promise.all([
    prisma.sLADefinition.findMany({
      where: {
        activeTo: null,
        ...(serviceId ? { serviceId } : {}),
        service: serviceReadWhere(actor),
      },
      include: { service: { select: { id: true, name: true } } },
      orderBy: { activeFrom: 'desc' },
    }),
    prisma.serviceObjective.findMany({
      where: {
        activeTo: null,
        legacySlaDefinitionId: null,
        ...(serviceId ? { serviceId } : {}),
        ...serviceObjectiveReadWhere(actor),
      },
      include: { service: { select: { id: true, name: true } } },
      orderBy: { activeFrom: 'desc' },
    }),
  ]);
  return NextResponse.json(
    [
      ...legacyDefinitions.map(definition => ({ ...definition, legacy: true })),
      ...objectives.map(objective => ({
        ...objective,
        id: objective.lineageId,
        window: legacyWindow(objective.windowType, objective.windowValue),
        legacy: false,
      })),
    ],
    { headers: LEGACY_SLA_DEPRECATION_HEADERS }
  );
}

export async function POST() {
  addOperationalMetric('opsknight_legacy_sla_api_requests_total', 1, {
    method: 'POST',
    endpoint_family: 'definitions',
  });
  return legacySlaGone();
}
