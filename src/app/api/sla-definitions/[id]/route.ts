import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { LEGACY_SLA_DEPRECATION_HEADERS, legacySlaGone, legacyWindow } from '@/lib/slo/http';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  addOperationalMetric('opsknight_legacy_sla_api_requests_total', 1, {
    method: 'GET',
    endpoint_family: 'definition',
  });
  const actor = await getCurrentAuthorizationActor();
  const id = (await params).id;
  const matchedObjective = await prisma.serviceObjective.findFirst({
    where: {
      OR: [{ lineageId: id }, { legacySlaDefinitionId: id }],
      ...serviceObjectiveReadWhere(actor),
    },
    orderBy: { version: 'desc' },
  });
  if (matchedObjective) {
    const [objective, versions] = await Promise.all([
      prisma.serviceObjective.findFirst({
        where: { lineageId: matchedObjective.lineageId, activeTo: null },
        include: { service: { select: { id: true, name: true } } },
      }),
      prisma.serviceObjective.findMany({
        where: { lineageId: matchedObjective.lineageId },
        select: { legacySlaDefinitionId: true },
      }),
    ]);
    if (!objective) {
      return NextResponse.json(
        { error: 'Service objective not found' },
        { status: 404, headers: LEGACY_SLA_DEPRECATION_HEADERS }
      );
    }
    const legacyIds = versions.flatMap(version =>
      version.legacySlaDefinitionId ? [version.legacySlaDefinitionId] : []
    );
    const legacySnapshots = await prisma.sLASnapshot.findMany({
      where: { slaDefinitionId: { in: legacyIds } },
      orderBy: { date: 'desc' },
      take: 30,
    });
    return NextResponse.json(
      {
        ...objective,
        id,
        objectiveId: objective.lineageId,
        versionId: objective.id,
        window: legacyWindow(objective.windowType, objective.windowValue),
        legacy: false,
        snapshots: legacySnapshots.map(snapshot => ({ ...snapshot, legacy: true })),
      },
      { headers: LEGACY_SLA_DEPRECATION_HEADERS }
    );
  }
  const legacyDefinition = await prisma.sLADefinition.findFirst({
    where: { id, service: serviceReadWhere(actor) },
    include: {
      service: { select: { id: true, name: true } },
      snapshots: { orderBy: { date: 'desc' }, take: 30 },
    },
  });
  if (!legacyDefinition) {
    return NextResponse.json(
      { error: 'Service objective not found' },
      { status: 404, headers: LEGACY_SLA_DEPRECATION_HEADERS }
    );
  }
  return NextResponse.json(
    {
      ...legacyDefinition,
      legacy: true,
      snapshots: legacyDefinition.snapshots.map(snapshot => ({ ...snapshot, legacy: true })),
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
