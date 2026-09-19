import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { jsonError, jsonOk } from '@/lib/api-response';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentAuthorizationActor();
  const objective = await prisma.serviceObjective.findFirst({
    where: {
      id: (await params).id,
      OR: [{ serviceId: null }, { service: serviceReadWhere(actor) }],
    },
    select: { id: true, legacySlaDefinitionId: true },
  });
  if (!objective) return jsonError('Service objective not found', 404);

  const [snapshots, legacySnapshots] = await Promise.all([
    prisma.serviceObjectiveSnapshot.findMany({
      where: { objectiveId: objective.id },
      orderBy: { periodEnd: 'desc' },
      take: 366,
    }),
    objective.legacySlaDefinitionId
      ? prisma.sLASnapshot.findMany({
          where: { slaDefinitionId: objective.legacySlaDefinitionId },
          orderBy: { date: 'desc' },
          take: 366,
        })
      : Promise.resolve([]),
  ]);
  return jsonOk({
    snapshots: snapshots.map(snapshot => ({
      ...snapshot,
      numerator: snapshot.numerator?.toString() ?? null,
      denominator: snapshot.denominator?.toString() ?? null,
      sampleCount: snapshot.sampleCount?.toString() ?? null,
    })),
    legacySnapshots: legacySnapshots.map(snapshot => ({ ...snapshot, legacy: true })),
  });
}
