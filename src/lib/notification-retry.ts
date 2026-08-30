/** Durable retry owner for persisted personal notification intents. */

import prisma from './prisma';
import { logger } from './logger';
import {
  dispatchNotificationAttempt,
  notificationRetryDelayMs,
  NOTIFICATION_RETRY_POLICY,
  type NotificationEventType,
} from './notification-delivery';

export async function retryFailedNotifications(): Promise<{
  retried: number;
  succeeded: number;
  failed: number;
}> {
  await prisma.notification.updateMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: new Date(Date.now() - NOTIFICATION_RETRY_POLICY.pendingTimeoutMs) },
      attempts: { lt: NOTIFICATION_RETRY_POLICY.maxAttempts },
    },
    data: {
      status: 'FAILED',
      failedAt: new Date(),
      errorMsg: 'Notification dispatch timed out before completion.',
    },
  });

  const now = Date.now();
  const failedNotifications = await prisma.notification.findMany({
    where: {
      status: 'FAILED',
      OR: Array.from({ length: NOTIFICATION_RETRY_POLICY.maxAttempts }, (_, attempts) => ({
        attempts,
        failedAt: { lte: new Date(now - notificationRetryDelayMs(attempts)) },
      })),
    },
    take: 100,
    orderBy: { failedAt: 'asc' },
    include: {
      incident: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          acknowledgedAt: true,
          resolvedAt: true,
          service: { select: { webhookUrl: true } },
        },
      },
    },
  });

  let succeeded = 0;
  let failed = 0;
  let retried = 0;
  const readyToRetry = failedNotifications;

  const BATCH_SIZE = 10;
  for (let i = 0; i < readyToRetry.length; i += BATCH_SIZE) {
    const batch = readyToRetry.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async notification => {
        try {
          const claim = await prisma.notification.updateMany({
            where: { id: notification.id, status: 'FAILED', attempts: notification.attempts },
            data: { status: 'PENDING', failedAt: null, errorMsg: null },
          });
          if (claim.count === 0) return { success: false, claimed: false };

          let result;
          try {
            result = await dispatchNotificationAttempt({
              notificationId: notification.id,
              incidentId: notification.incidentId,
              userId: notification.userId,
              channel: notification.channel,
              eventType: notification.eventType as NotificationEventType,
              message: notification.message,
              incident: notification.incident,
            });
          } catch (dispatchError) {
            result = {
              success: false,
              outcome: 'RETRYABLE_FAILURE' as const,
              error: dispatchError instanceof Error ? dispatchError.message : 'Provider error',
            };
          }

          if (result.outcome === 'DELIVERED') {
            await prisma.notification.update({
              where: { id: notification.id },
              data: {
                status: 'SENT',
                sentAt: new Date(),
                providerMessageId: result.providerMessageId,
              },
            });
            logger.info('notification.retry.success', {
              notificationId: notification.id,
              channel: notification.channel,
            });
            return { success: true, claimed: true };
          }

          if (result.outcome === 'SKIPPED') {
            await prisma.notification.update({
              where: { id: notification.id },
              data: {
                status: 'SKIPPED',
                errorMsg: result.error || 'Delivery skipped by notification policy.',
              },
            });
            return { success: true, claimed: true, skipped: true };
          }

          if (result.outcome === 'QUEUED') {
            await prisma.notification.update({
              where: { id: notification.id },
              data: {
                status: 'FAILED',
                failedAt: new Date(),
                errorMsg: result.error || 'Provider admission deferred',
                attempts: notification.attempts,
              },
            });
            return { success: false, claimed: true, deferred: true };
          }

          const circuitOpen = result.outcome === 'CIRCUIT_OPEN';
          const permanentFailure = result.outcome === 'PERMANENT_FAILURE';
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              errorMsg: result.error || 'Retry failed',
              attempts: circuitOpen
                ? notification.attempts
                : permanentFailure
                  ? NOTIFICATION_RETRY_POLICY.maxAttempts
                  : (notification.attempts || 0) + 1,
            },
          });
          return { success: false, claimed: true };
        } catch (error: unknown) {
          logger.error('notification.retry.error', {
            notificationId: notification.id,
            error: error instanceof Error ? error.message : String(error),
          });
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              errorMsg: error instanceof Error ? error.message : String(error),
              attempts: (notification.attempts || 0) + 1,
            },
          });
          return { success: false, claimed: true };
        }
      })
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value.claimed) continue;
      retried++;
      if (result.value.success) succeeded++;
      else failed++;
    }
  }

  return { retried, succeeded, failed };
}

/** Earliest time at which the scheduler has notification recovery work. */
export async function getNextNotificationRetryAt(): Promise<Date | null> {
  const attempts = Array.from(
    { length: NOTIFICATION_RETRY_POLICY.maxAttempts },
    (_, value) => value
  );
  const [pending, ...failedByAttempt] = await Promise.all([
    prisma.notification.findFirst({
      where: {
        status: 'PENDING',
        attempts: { lt: NOTIFICATION_RETRY_POLICY.maxAttempts },
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    ...attempts.map(attempt =>
      prisma.notification.findFirst({
        where: { status: 'FAILED', attempts: attempt, failedAt: { not: null } },
        orderBy: { failedAt: 'asc' },
        select: { failedAt: true },
      })
    ),
  ]);

  const dueTimes = [
    pending?.createdAt
      ? pending.createdAt.getTime() + NOTIFICATION_RETRY_POLICY.pendingTimeoutMs
      : null,
    ...failedByAttempt.map((notification, attempt) =>
      notification?.failedAt
        ? notification.failedAt.getTime() + notificationRetryDelayMs(attempt)
        : null
    ),
  ].filter((value): value is number => value !== null);

  return dueTimes.length > 0 ? new Date(Math.min(...dueTimes)) : null;
}

export async function getNotificationRetryStats(): Promise<{
  pending: number;
  failed: number;
  failedRecent: number;
}> {
  const [pending, failed, failedRecent] = await Promise.all([
    prisma.notification.count({ where: { status: 'PENDING' } }),
    prisma.notification.count({ where: { status: 'FAILED' } }),
    prisma.notification.count({
      where: { status: 'FAILED', failedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);
  return { pending, failed, failedRecent };
}
