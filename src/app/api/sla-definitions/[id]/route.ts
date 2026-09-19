import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { LEGACY_SLA_DEPRECATION_HEADERS, legacySlaGone, legacyWindow } from '@/lib/slo/http';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  addOperationalMetric('opsknight_legacy_sla_api_requests_total', 1, {
    method: 'GET',
    endpoint_family: 'definition',
  });
  const actor = await getCurrentAuthorizationActor();
  const id = (await params).id;
  const objective = await prisma.serviceObjective.findFirst({
    where: {
      OR: [
        { id, serviceId: null },
        { legacySlaDefinitionId: id, serviceId: null },
        { id, service: serviceReadWhere(actor) },
        { legacySlaDefinitionId: id, service: serviceReadWhere(actor) },
      ],
    },
    include: { service: { select: { id: true, name: true } } },
  });
  if (!objective) {
    return NextResponse.json(
      { error: 'Service objective not found' },
      { status: 404, headers: LEGACY_SLA_DEPRECATION_HEADERS }
    );
  }
  const legacySnapshots = objective.legacySlaDefinitionId
    ? await prisma.sLASnapshot.findMany({
        where: { slaDefinitionId: objective.legacySlaDefinitionId },
        orderBy: { date: 'desc' },
        take: 30,
      })
    : [];
  return NextResponse.json(
    {
      ...objective,
      window: legacyWindow(objective.windowType, objective.windowValue),
      snapshots: legacySnapshots.map(snapshot => ({ ...snapshot, legacy: true })),
    },
    { headers: LEGACY_SLA_DEPRECATION_HEADERS }
  );
}

function retiredWrite(method: string) {
  addOperationalMetric('opsknight_legacy_sla_api_requests_total', 1, {
    method,
    endpoint_family: 'definition',
  });
  return legacySlaGone();
}

export async function PATCH() {
  return retiredWrite('PATCH');
}
export async function DELETE() {
  return retiredWrite('DELETE');
}
