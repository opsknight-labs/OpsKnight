import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { logger } from './logger';

export const LEGACY_NOTIFICATION_CLAIM_MS = 10 * 60_000;
export const URGENT_NOTIFICATION_CLAIM_MS = 20_000;
export const NOTIFICATION_CLAIM_HEARTBEAT_MS = 5_000;
const urgent = ['CRITICAL', 'TRANSACTIONAL'] as const;

export function notificationClaimAvailable(now: Date): Prisma.NotificationWhereInput {
  const legacy = { lt: new Date(now.getTime() - LEGACY_NOTIFICATION_CLAIM_MS) };
  return {
    OR: [
      { lastAttemptAt: null },
      { claimToken: null, lastAttemptAt: legacy },
      { claimHeartbeatAt: null, lastAttemptAt: legacy },
      { trafficClass: { notIn: [...urgent] }, lastAttemptAt: legacy },
      {
        trafficClass: { in: [...urgent] },
        claimToken: { not: null },
        claimHeartbeatAt: { lt: new Date(now.getTime() - URGENT_NOTIFICATION_CLAIM_MS) },
      },
    ],
  };
}

export function notificationClaimDeadlineSql(alias?: 'notification'): Prisma.Sql {
  const prefix = alias ? Prisma.sql`notification.` : Prisma.empty;
  return Prisma.sql`CASE WHEN ${prefix}"claimToken" IS NOT NULL AND ${prefix}"claimHeartbeatAt" IS NOT NULL
    AND ${prefix}"trafficClass" IN ('CRITICAL'::"NotificationTrafficClass", 'TRANSACTIONAL'::"NotificationTrafficClass")
    THEN ${prefix}"claimHeartbeatAt" + (${URGENT_NOTIFICATION_CLAIM_MS} * INTERVAL '1 millisecond')
    ELSE ${prefix}"lastAttemptAt" + (${LEGACY_NOTIFICATION_CLAIM_MS} * INTERVAL '1 millisecond') END`;
}

export function startNotificationClaimHeartbeat(
  claims: readonly { id: string; claimToken: string }[],
  claimedAt: Date
): () => void {
  if (!claims.length) return () => undefined;
  const timer = setInterval(() => {
    void prisma.notification
      .updateMany({
        where: {
          status: 'PENDING',
          lastAttemptAt: claimedAt,
          trafficClass: { in: [...urgent] },
          OR: claims.map(({ id, claimToken }) => ({ id, claimToken })),
        },
        data: { claimHeartbeatAt: new Date() },
      })
      .catch(() => logger.warn('notification.claim_heartbeat_failed', { claims: claims.length }));
  }, NOTIFICATION_CLAIM_HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
