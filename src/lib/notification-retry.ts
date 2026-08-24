/**
 * Notification Retry Mechanism
 * Handles retrying failed notifications with exponential backoff
 */

import prisma from './prisma';
import { logger } from './logger';
import { CircuitBreakers } from './circuit-breaker';

const _MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 5000; // 5 seconds
const MAX_RETRY_DELAY_MS = 300000; // 5 minutes

/**
 * Retry failed notifications
 * Should be called periodically by the internal worker
 */
export async function retryFailedNotifications(): Promise<{
  retried: number;
  succeeded: number;
  failed: number;
}> {
  const failedNotifications = await prisma.notification.findMany({
    where: {
      status: 'FAILED',
      failedAt: {
        not: null,
      },
      attempts: {
        lt: _MAX_RETRY_ATTEMPTS,
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
    const retryDelay = Math.min(
      INITIAL_RETRY_DELAY_MS * Math.pow(2, notification.attempts || 0),
      MAX_RETRY_DELAY_MS
    );
    return timeSinceFailure >= retryDelay;
  });

  // Pre-load channel handlers to avoid repeated dynamic imports
  const emailModule = await import('./email');
  const smsModule = await import('./sms');
  const pushModule = await import('./push');
  const whatsappModule = await import('./whatsapp');
  const webhooksModule = await import('./webhooks');

  // Helper to determine event type from incident status
  const getEventType = (status?: string) =>
    status === 'RESOLVED' ? 'resolved' : status === 'ACKNOWLEDGED' ? 'acknowledged' : 'triggered';

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

          let result: { success: boolean; error?: string } = {
            success: false,
            error: 'Unknown channel',
          };

          const eventType = getEventType(notification.incident?.status);

          // Re-dispatch based on channel with circuit breaker protection
          try {
            switch (notification.channel) {
              case 'EMAIL':
                result = await CircuitBreakers.email().execute(async () => {
                  const res = await emailModule.sendIncidentEmail(
                    notification.userId,
                    notification.incidentId,
                    eventType
                  );
                  if (!res.success) throw new Error(res.error || 'Email retry delivery failed');
                  return res;
                });
                break;
              case 'SMS':
                result = await CircuitBreakers.sms().execute(async () => {
                  const res = await smsModule.sendIncidentSMS(
                    notification.userId,
                    notification.incidentId,
                    eventType
                  );
                  if (!res.success) throw new Error(res.error || 'SMS retry delivery failed');
                  return res;
                });
                break;
              case 'PUSH':
                result = await CircuitBreakers.push().execute(async () => {
                  const res = await pushModule.sendIncidentPush(
                    notification.userId,
                    notification.incidentId,
                    eventType
                  );
                  if (!res.success) throw new Error(res.error || 'Push retry delivery failed');
                  return res;
                });
                break;
              case 'WHATSAPP':
                result = await CircuitBreakers.whatsapp().execute(async () => {
                  const res = await whatsappModule.sendIncidentWhatsApp(
                    notification.userId,
                    notification.incidentId,
                    eventType
                  );
                  if (!res.success) throw new Error(res.error || 'WhatsApp retry delivery failed');
                  return res;
                });
                break;
              case 'WEBHOOK':
                if (notification.incident?.service?.webhookUrl) {
                  result = await CircuitBreakers.webhook(
                    notification.incident.service.webhookUrl
                  ).execute(async () => {
                    const res = await webhooksModule.sendIncidentWebhook(
                      notification.incident!.service!.webhookUrl!,
                      notification.incidentId,
                      eventType
                    );
                    if (!res.success) throw new Error(res.error || 'Webhook retry delivery failed');
                    return res;
                  });
                } else {
                  result = {
                    success: false,
                    error: 'No webhook URL configured on incident service',
                  };
                }
                break;
              default:
                result = {
                  success: false,
                  error: `Retry not implemented for channel: ${notification.channel}`,
                };
            }
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
        } catch (error: any) {
          logger.error('notification.retry.error', {
            notificationId: notification.id,
            error: error.message,
          });

          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              errorMsg: error.message,
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
