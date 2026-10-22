import type { Prisma } from '@prisma/client';
import { decodeCursor } from './pagination';

export const notificationAttemptSelect = {
  id: true, notificationId: true, ordinal: true, outcome: true, provider: true,
  errorCode: true, startedAt: true, finishedAt: true,
  reconciliationDeadline: true, latencyMs: true,
} satisfies Prisma.NotificationDeliveryAttemptSelect;

export function notificationAttemptCursorWhere(cursor: string | null): Prisma.NotificationDeliveryAttemptWhereInput | null {
  if (!cursor) return null;
  const decoded = decodeCursor(cursor);
  const startedAt = new Date(decoded.createdAt);
  return { OR: [
    { startedAt: { lt: startedAt } },
    { startedAt, id: { lt: decoded.id } },
  ] };
}

export function safeNotificationAttempt<T extends { errorCode: string | null; startedAt: Date }>(row: T) {
  return {
    ...row,
    errorCode: row.errorCode && /^[A-Z][A-Z0-9_]{1,63}$/.test(row.errorCode)
      ? row.errorCode : null,
    // formatCursorPagination signs this timestamp as createdAt.
    createdAt: row.startedAt,
  };
}
