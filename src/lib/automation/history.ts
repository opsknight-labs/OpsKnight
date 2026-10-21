import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { decodeCursor, encodeCursor } from '@/lib/api-v2/pagination';
import { snapshotSchema } from './contract';

export const automationVersionSummary = {
  id: true,
  serviceId: true,
  versionNumber: true,
  checksum: true,
  sourceVersionId: true,
  publishedAt: true,
  publishedBy: true,
} as const;

/** Version-number ordering remains stable even if transactions start before
 * waiting for the publication lock. A cursor is checked against this service.
 */
export async function listAutomationHistory(
  tx: Prisma.TransactionClient,
  serviceId: string,
  limit: number,
  cursor: string | null
) {
  let before: number | undefined;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    const boundary = await tx.automationVersion.findFirst({
      where: { id: decoded.id, serviceId },
      select: { versionNumber: true, publishedAt: true },
    });
    if (!boundary || boundary.publishedAt.toISOString() !== decoded.createdAt)
      throw new AppError({ code: 'INVALID_PAGINATION_CURSOR' });
    before = boundary.versionNumber;
  }
  const rows = await tx.automationVersion.findMany({
    where: { serviceId, ...(before === undefined ? {} : { versionNumber: { lt: before } }) },
    select: automationVersionSummary,
    orderBy: { versionNumber: 'desc' },
    take: limit + 1,
  });
  const data = rows.slice(0, limit),
    hasMore = rows.length > limit,
    last = data.at(-1);
  return {
    data,
    pagination: {
      limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ id: last.id, createdAt: last.publishedAt.toISOString() })
          : null,
    },
  };
}

export async function readAutomationVersion(
  tx: Prisma.TransactionClient,
  serviceId: string,
  versionId: string
) {
  const version = await tx.automationVersion.findFirst({
    where: { id: versionId, serviceId },
    select: { ...automationVersionSummary, snapshot: true, lintReport: true },
  });
  if (!version) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const parsed = snapshotSchema.safeParse(version.snapshot);
  if (!parsed.success) throw new AppError({ code: 'INTERNAL_ERROR' });
  return { ...version, snapshot: parsed.data };
}
