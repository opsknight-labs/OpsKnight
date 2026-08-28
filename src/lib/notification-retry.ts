/**
 * Notification Retry Mechanism
 * Handles retrying failed notifications with exponential backoff
 */

import prisma from './prisma';
import { logger } from './logger';
import {
  dispatchNotificationAttempt,
  notificationRetryDelayMs,
  NOTIFICATION_RETRY_POLICY,
} from './notification-delivery';

/**
 * Retry failed notifications
 * Should be called periodically by the internal worker
 */
export async function retryFailedNotifications(): Promise<{
  retried: number;
  succeeded: number;
  failed: number;
}> {
  // A process can die after creating/claiming a notification but before it
  // records success or failure. Reclaim those orphaned PENDING rows into the
  // normal retry flow instead of leaving them stuck forever.
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

  const failedNotifications = await prisma.notification.findMany({
    where: {
      status: 'FAILED',
      failedAt: {
        not: null,
      },
      attempts: {
        lt: NOTIFICATION_RETRY_POLICY.maxAttempts,
      },
    },
    take: 100, // Process in batches
    orderBy: {
      failedAt: 'asc', // Retry oldest failures first
    },
    include: {
      incident: {
        select: {
          id: true,
          status: true,
          service: {
            select: {
              webhookUrl: true,
            },
          },
        },
      },
    },
  });

  let succeeded = 0;
  let failed = 0;
  let retried = 0;

  // Filter notifications that are ready to retry based on backoff delay
  const now = Date.now();
  const readyToRetry = failedNotifications.filter(notification => {
    const timeSinceFailure = now - (notification.failedAt?.getTime() || 0);
    const retryDelay = notificationRetryDelayMs(notification.attempts || 0);
    return timeSinceFailure >= retryDelay;
  });

  // Process in parallel batches of 10 for better throughput
  const BATCH_SIZE = 10;
  for (let i = 0; i < readyToRetry.length; i += BATCH_SIZE) {
    const batch = readyToRetry.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async notification => {
        try {
          // Atomically claim the failed notification. Another replica may
          // have read the same batch; only the worker that changes FAILED to
          // PENDING is allowed to contact the provider.
          const claim = await prisma.notification.updateMany({
            where: {
              id: notification.id,
              status: 'FAILED',
              attempts: notification.attempts,
            },
            data: {
              status: 'PENDING',
              failedAt: null,
              errorMsg: null,
            },
          });
          if (claim.count === 0) {
            return { success: false, claimed: false };
          }

          let result;
          try {
            result = await dispatchNotificationAttempt({
              notificationId: notification.id,
              incidentId: notification.incidentId,
              userId: notification.userId,
              channel: notification.channel,
              incident: notification.incident,
            });
          } catch (cbError) {
            result = {
              success: false,
              error:
                cbError instanceof Error ? cbError.message : 'Circuit breaker / provider error',
            };
          }

          if (result.success) {
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
          } else {
            await prisma.notification.update({
              where: { id: notification.id },
              data: {
                status: 'FAILED',
                failedAt: new Date(),
                errorMsg: result.error || 'Retry failed',
                attempts: (notification.attempts || 0) + 1,
              },
            });
            return { success: false, claimed: true };
          }
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

    // Count successes and failures from batch
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value.claimed) continue;
      retried++;
      if (result.value.success) {
        succeeded++;
      } else {
        failed++;
      }
    }
  }

  return {
    retried,
    succeeded,
    failed,
  };
}

/**
 * Get notification retry statistics
 */
export async function getNotificationRetryStats(): Promise<{
  pending: number;
  failed: number;
  failedRecent: number; // Failed in last 24 hours
}> {
  const [pending, failed, failedRecent] = await Promise.all([
    prisma.notification.count({
      where: { status: 'PENDING' },
    }),
    prisma.notification.count({
      where: { status: 'FAILED' },
    }),
    prisma.notification.count({
      where: {
        status: 'FAILED',
        failedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  return { pending, failed, failedRecent };
}
