import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { jsonError, jsonOk } from '@/lib/api-response';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentAuthorizationActor();
  const lineageId = (await params).id;
  const versions = await prisma.serviceObjective.findMany({
    where: {
      lineageId,
      ...serviceObjectiveReadWhere(actor),
    },
    orderBy: { version: 'asc' },
  });
  if (versions.length === 0) return jsonError('Service objective not found', 404);
  const versionIds = versions.map(version => version.id);
  const legacySlaDefinitionIds = versions.flatMap(version =>
    version.legacySlaDefinitionId ? [version.legacySlaDefinitionId] : []
  );

  const [snapshots, legacySnapshots] = await Promise.all([
    prisma.serviceObjectiveSnapshot.findMany({
      where: { objectiveId: { in: versionIds } },
      orderBy: { periodEnd: 'desc' },
      take: 366,
    }),
    legacySlaDefinitionIds.length > 0
      ? prisma.sLASnapshot.findMany({
          where: { slaDefinitionId: { in: legacySlaDefinitionIds } },
          orderBy: { date: 'desc' },
          take: 366,
        })
      : Promise.resolve([]),
  ]);
  return jsonOk({
    versions: versions.map(version => ({
      ...version,
      id: version.lineageId,
      versionId: version.id,
    })),
    snapshots: snapshots.map(snapshot => ({
      ...snapshot,
      numerator: snapshot.numerator?.toString() ?? null,
      denominator: snapshot.denominator?.toString() ?? null,
      sampleCount: snapshot.sampleCount?.toString() ?? null,
    })),
    legacySnapshots: legacySnapshots.map(snapshot => ({ ...snapshot, legacy: true })),
  });
}
