import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { decodeCursor, formatCursorPagination } from '@/lib/api-v2/pagination';

/** Stable first-seen ordering avoids moving rows when counters are refreshed.
 * Raw values and their hashes are never selected by the public API.
 */
export async function listAutomationObservations(
  tx: Prisma.TransactionClient,
  serviceId: string,
  limit: number,
  cursor: string | null,
  unmapped?: boolean
) {
  let boundary: { id: string; firstSeenAt: Date } | null = null;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    boundary = await tx.automationContextObservation.findFirst({
      where: { id: decoded.id, serviceId, ...(unmapped === undefined ? {} : { unmapped }) },
      select: { id: true, firstSeenAt: true },
    });
    if (!boundary || boundary.firstSeenAt.toISOString() !== decoded.createdAt)
      throw new AppError({ code: 'INVALID_PAGINATION_CURSOR' });
  }
  const rows = await tx.automationContextObservation.findMany({
    where: {
      serviceId,
      ...(unmapped === undefined ? {} : { unmapped }),
      ...(boundary
        ? {
            OR: [
              { firstSeenAt: { lt: boundary.firstSeenAt } },
              { firstSeenAt: boundary.firstSeenAt, id: { lt: boundary.id } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      serviceId: true,
      integrationId: true,
      integrationType: true,
      fieldKey: true,
      sourcePath: true,
      fieldType: true,
      unmapped: true,
      count: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
    orderBy: [{ firstSeenAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = formatCursorPagination(
    rows.map(row => ({ ...row, createdAt: row.firstSeenAt })),
    limit
  );
  return { ...page, data: page.data.map(({ createdAt: _createdAt, ...row }) => row) };
}
