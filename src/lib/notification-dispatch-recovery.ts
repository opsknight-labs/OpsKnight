import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { notificationClaimDeadlineSql } from './notification-claim-lease';

/** A dispatch marker without a receipt is ambiguous after its owner disappears.
 * Change the parent and attempt together before allowing any replacement send. */
export async function recoverAbandonedNotificationDispatches(
  now: Date,
  reconciliationDelayMs: number,
  limit = 100,
  notificationId?: string
): Promise<number> {
  const reviewAt = new Date(now.getTime() + reconciliationDelayMs);
  const target = notificationId
    ? Prisma.sql`AND notification.id = ${notificationId}`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH candidates AS MATERIALIZED (
      SELECT notification.id FROM "Notification" notification
      WHERE notification.status = 'PENDING'::"NotificationStatus"
        AND ${notificationClaimDeadlineSql('notification')} < ${now}
        ${target}
        AND EXISTS (
          SELECT 1 FROM "NotificationDeliveryAttempt" attempt
          WHERE attempt."notificationId" = notification.id
            AND attempt.outcome = 'IN_FLIGHT' AND attempt."finishedAt" IS NULL
        )
      ORDER BY notification."lastAttemptAt", notification.id
      LIMIT ${Math.max(1, Math.min(limit, 500))} FOR UPDATE OF notification SKIP LOCKED
    ), recovered AS (
      UPDATE "Notification" notification
      SET status = 'UNKNOWN'::"NotificationStatus", "reconciliationDeadline" = ${reviewAt},
          "errorMsg" = 'Delivery owner disappeared during dispatch; reconcile the provider receipt before retrying.'
      FROM candidates WHERE notification.id = candidates.id
        AND notification.status = 'PENDING'::"NotificationStatus"
        AND ${notificationClaimDeadlineSql('notification')} < ${now}
      RETURNING notification.id
    ), attempts AS (
      UPDATE "NotificationDeliveryAttempt" attempt
      SET outcome = 'UNKNOWN', "errorCode" = 'DISPATCH_OWNER_LOST',
          "errorMessage" = 'The dispatch owner disappeared before recording the provider outcome.',
          "reconciliationDeadline" = ${reviewAt}
      FROM recovered WHERE attempt."notificationId" = recovered.id
        AND attempt.outcome = 'IN_FLIGHT' AND attempt."finishedAt" IS NULL
      RETURNING attempt.id
    ) SELECT id FROM recovered
  `);
  return rows.length;
}
