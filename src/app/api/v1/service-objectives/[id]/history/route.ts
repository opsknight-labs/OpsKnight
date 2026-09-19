import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { jsonError, jsonOk } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentAuthorizationActor();
  const lineageId = (await params).id;
  const searchParams = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 500);
  const snapshotCursor = searchParams.get('snapshotCursor');
  const legacyCursor = searchParams.get('legacyCursor');
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
      orderBy: [{ periodEnd: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(snapshotCursor ? { cursor: { id: snapshotCursor }, skip: 1 } : {}),
    }),
    legacySlaDefinitionIds.length > 0
      ? prisma.sLASnapshot.findMany({
          where: { slaDefinitionId: { in: legacySlaDefinitionIds } },
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(legacyCursor ? { cursor: { id: legacyCursor }, skip: 1 } : {}),
        })
      : Promise.resolve([]),
  ]);
  return jsonOk({
    versions: versions.map(version => ({
      ...version,
      id: version.lineageId,
      versionId: version.id,
    })),
    snapshots: snapshots.slice(0, limit).map(snapshot => ({
      ...snapshot,
      numerator: snapshot.numerator?.toString() ?? null,
      denominator: snapshot.denominator?.toString() ?? null,
      sampleCount: snapshot.sampleCount?.toString() ?? null,
    })),
    legacySnapshots: legacySnapshots
      .slice(0, limit)
      .map(snapshot => ({ ...snapshot, legacy: true })),
    pagination: {
      nextSnapshotCursor: snapshots.length > limit ? snapshots[limit - 1]?.id : null,
      nextLegacyCursor: legacySnapshots.length > limit ? legacySnapshots[limit - 1]?.id : null,
    },
  });
}
