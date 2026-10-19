import { requireSharedObjectiveHistory } from '@/lib/slo/authorization';
import 'server-only';
import { Prisma } from '@prisma/client';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  requireReadableObjective,
  objectiveCursor,
  objectivePagination,
} from '@/lib/api-v2/service-objectives';

export async function readObjectiveSnapshots(
  db: Prisma.TransactionClient,
  actor: AuthorizationActor,
  lineageId: string,
  limit: number,
  cursor: string | null
) {
  requireSharedObjectiveHistory(actor);
  await requireReadableObjective(db, actor, lineageId);
  const scope = `objective-snapshots:${lineageId}`;
  const boundary = objectiveCursor(cursor, scope);
  const rows = await db.serviceObjectiveSnapshot.findMany({
    where: {
      objective: { lineageId },
      ...(boundary
        ? {
            OR: [
              { periodEnd: { lt: boundary.at } },
              { periodEnd: boundary.at, id: { lt: boundary.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ periodEnd: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const result = objectivePagination(rows, limit, scope, row => row.periodEnd);
  return {
    data: result.data.map(row => ({
      ...row,
      numerator: row.numerator?.toString() ?? null,
      denominator: row.denominator?.toString() ?? null,
      sampleCount: row.sampleCount?.toString() ?? null,
    })),
    pagination: result.pagination,
  };
}

/** Legacy incident-SLA history stays explicitly separate from objective measurements.
 * EXISTS avoids materializing every historical legacy-definition ID into application memory.
 */
export async function readObjectiveLegacyHistory(
  db: Prisma.TransactionClient,
  actor: AuthorizationActor,
  lineageId: string,
  limit: number,
  cursor: string | null
) {
  requireSharedObjectiveHistory(actor);
  await requireReadableObjective(db, actor, lineageId);
  const scope = `objective-legacy:${lineageId}`;
  const boundary = objectiveCursor(cursor, scope);
  const rows = await db.$queryRaw<Prisma.SLASnapshotGetPayload<Record<string, never>>[]>`
    SELECT snapshot.* FROM "SLASnapshot" snapshot
    WHERE EXISTS (SELECT 1 FROM "ServiceObjective" objective
      WHERE objective."lineageId"=${lineageId} AND objective."legacySlaDefinitionId"=snapshot."slaDefinitionId")
      ${boundary ? Prisma.sql`AND (snapshot.date < ${boundary.at} OR (snapshot.date=${boundary.at} AND snapshot.id < ${boundary.id}))` : Prisma.empty}
    ORDER BY snapshot.date DESC,snapshot.id DESC LIMIT ${limit + 1}
  `;
  return objectivePagination(rows, limit, scope, row => row.date);
}
