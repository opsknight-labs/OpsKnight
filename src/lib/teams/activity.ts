import 'server-only';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { projectAuditDetails } from '@/lib/api-v2/audit-projection';
import { decodeCursor, formatCursorPagination } from '@/lib/api-v2/pagination';
import { sanitizeString } from '@/lib/logger';
import { requireTeamAccess, type TeamCommandActor } from './administration';

/** Same event set for UI and REST, with one indexed, bounded keyset query. */
export async function listTeamActivity(
  tx: Prisma.TransactionClient,
  teamId: string,
  actor: TeamCommandActor,
  pagination: { limit: number; cursor: string | null }
) {
  await requireTeamAccess(tx, teamId, actor, false, true);
  if (!Number.isSafeInteger(pagination.limit) || pagination.limit < 1 || pagination.limit > 100)
    throw new AppError({ code: 'INVALID_PAGINATION_LIMIT' });
  const cursor = pagination.cursor ? decodeCursor(pagination.cursor) : null;
  if (
    cursor &&
    !(await tx.auditLog.findFirst({
      where: {
        id: cursor.id,
        createdAt: new Date(cursor.createdAt),
        OR: [
          { entityType: 'TEAM', entityId: teamId },
          { entityType: 'TEAM_MEMBER', entityId: { startsWith: `${teamId}:` } },
        ],
      },
      select: { id: true },
    }))
  )
    throw new AppError({ code: 'INVALID_PAGINATION_CURSOR' });
  type ActivityRow = {
    id: string;
    action: string;
    createdAt: Date;
    actorId: string | null;
    actorName: string | null;
    details: Prisma.JsonValue | null;
  };
  // Complete tagged queries keep SQL structure independent of Prisma fragment
  // identities across the Next.js RSC and route-handler production bundles.
  const rows = cursor
    ? await tx.$queryRaw<ActivityRow[]>`
        SELECT id, action, "createdAt", "actorId", "actorName", details
        FROM "AuditLog"
        WHERE "entityType" IN ('TEAM', 'TEAM_MEMBER')
          AND split_part("entityId", ':', 1) = ${teamId}
          AND ("createdAt", id) < (${new Date(cursor.createdAt)}, ${cursor.id})
        ORDER BY "createdAt" DESC, id DESC
        LIMIT ${pagination.limit + 1}
      `
    : await tx.$queryRaw<ActivityRow[]>`
        SELECT id, action, "createdAt", "actorId", "actorName", details
        FROM "AuditLog"
        WHERE "entityType" IN ('TEAM', 'TEAM_MEMBER')
          AND split_part("entityId", ':', 1) = ${teamId}
        ORDER BY "createdAt" DESC, id DESC
        LIMIT ${pagination.limit + 1}
      `;
  return formatCursorPagination(
    rows.map(row => ({
      id: row.id,
      action: sanitizeString(row.action),
      createdAt: row.createdAt,
      actor: row.actorId
        ? { id: row.actorId, name: row.actorName ? sanitizeString(row.actorName) : null }
        : null,
      details: projectTeamActivityDetails(row.details),
    })),
    pagination.limit
  );
}

/** Team history exposes reviewed business fields, never the audit envelope or caller credentials. */
function projectTeamActivityDetails(details: Prisma.JsonValue | null) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const envelope = new Map(Object.entries(details));
  const metadata = envelope.get('metadata');
  const source =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : details;
  const allowed = new Set([
    'teamId',
    'userId',
    'role',
    'receiveTeamNotifications',
    'teamLeadId',
    'serviceIds',
    'name',
  ]);
  return projectAuditDetails(
    Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)))
  );
}
