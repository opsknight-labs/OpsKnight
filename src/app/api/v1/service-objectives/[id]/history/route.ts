import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { jsonError, jsonOk } from '@/lib/api-response';
import { v1ErrorResponse } from '@/lib/api-v1-errors';

// Versions accompany the history payload; the newest are returned, oldest first.
const MAX_VERSIONS = 200;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentAuthorizationActor();
    const lineageId = (await params).id;
    const searchParams = new URL(request.url).searchParams;
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 500);
    const snapshotCursor = searchParams.get('snapshotCursor');
    const legacyCursor = searchParams.get('legacyCursor');
    const lineageWhere = { lineageId, ...serviceObjectiveReadWhere(actor) };
    // Only the newest versions are returned (bounded); snapshot queries still span every version
    // of the lineage through a relation filter rather than a materialised id list.
    const newest = await prisma.serviceObjective.findMany({
      where: lineageWhere,
      orderBy: { version: 'desc' },
      take: MAX_VERSIONS + 1,
    });
    if (newest.length === 0) return jsonError('Service objective not found', 404);
    const versionsTruncated = newest.length > MAX_VERSIONS;
    const versions = newest.slice(0, MAX_VERSIONS).reverse();
    const legacySlaDefinitionIds = (
      await prisma.serviceObjective.findMany({
        where: { ...lineageWhere, legacySlaDefinitionId: { not: null } },
        select: { legacySlaDefinitionId: true },
        distinct: ['legacySlaDefinitionId'],
      })
    ).flatMap(version => (version.legacySlaDefinitionId ? [version.legacySlaDefinitionId] : []));

    const [snapshots, legacySnapshots] = await Promise.all([
      prisma.serviceObjectiveSnapshot.findMany({
        where: { objective: lineageWhere },
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
      // When true, page through every version with GET /api/v1/service-objectives/{id}/versions.
      versionsTruncated,
      pagination: {
        nextSnapshotCursor: snapshots.length > limit ? snapshots[limit - 1]?.id : null,
        nextLegacyCursor: legacySnapshots.length > limit ? legacySnapshots[limit - 1]?.id : null,
      },
    });
  } catch (error) {
    return v1ErrorResponse(error, 'read service objective history');
  }
}
