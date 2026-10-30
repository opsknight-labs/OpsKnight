import type { Prisma, ServiceObjective } from '@prisma/client';
import { z } from 'zod/v3';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { decodeCursor, formatCursorPagination } from './pagination';
import { requireRevisionIfMatch } from './concurrency';

export const ObjectiveParams = z.object({ id: z.string().regex(/^[a-z0-9_-]{1,64}$/i) }).strict();
export async function requireReadableObjective(
  db: Prisma.TransactionClient,
  actor: AuthorizationActor,
  lineageId: string,
  versionId?: string
) {
  const objective = await db.serviceObjective.findFirst({
    where: {
      lineageId,
      ...(versionId ? { id: versionId } : {}),
      ...serviceObjectiveReadWhere(actor),
    },
    orderBy: { version: 'desc' },
  });
  if (!objective) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  return objective;
}
export function objectiveRevision(row: Pick<ServiceObjective, 'version' | 'activeTo'>) {
  return row.version * 2 + (row.activeTo ? 1 : 0);
}
export function requireObjectiveVersion(req: Request) {
  const revision = requireRevisionIfMatch(req);
  if (revision % 2 !== 0) throw new AppError({ code: 'PRECONDITION_FAILED' });
  return revision / 2;
}
export function projectObjective(row: ServiceObjective) {
  return {
    id: row.lineageId,
    versionId: row.id,
    serviceId: row.serviceId,
    name: row.name,
    description: row.description,
    metricType: row.metricType,
    target: row.target,
    comparator: row.comparator,
    windowType: row.windowType,
    windowValue: row.windowValue,
    version: row.version,
    revision: objectiveRevision(row),
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
    status: row.activeTo ? 'ARCHIVED' : 'ACTIVE',
    legacySlaDefinitionId: row.legacySlaDefinitionId,
    createdAt: row.createdAt,
  };
}
export function objectiveCursor(cursor: string | null, scope: string) {
  if (!cursor) return null;
  const decoded = decodeCursor(cursor);
  if (!decoded.id.startsWith(`${scope}|`))
    throw new AppError({ code: 'INVALID_PAGINATION_CURSOR' });
  return { id: decoded.id.slice(scope.length + 1), at: new Date(decoded.createdAt) };
}
export function objectivePagination<T extends { id: string }>(
  rows: T[],
  limit: number,
  scope: string,
  date: (row: T) => Date
) {
  const page = formatCursorPagination(
    rows.map(row => ({ id: `${scope}|${row.id}`, createdAt: date(row) })),
    limit
  );
  return { data: rows.slice(0, limit), pagination: page.pagination };
}
