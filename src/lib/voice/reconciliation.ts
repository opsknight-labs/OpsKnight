import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getTwilioVoiceCallbackCredentials } from '@/lib/notification-providers';

type TwilioCall = { sid: string; status: string };
type TwilioClient = { calls: (sid: string) => { fetch: () => Promise<TwilioCall> } };
type TwilioFactory = (accountSid: string, authToken: string) => TwilioClient;

const STALE_VOICE_CALL_AGE_MS = 3 * 60_000; // 3 minutes

/**
 * Reconciles voice calls that were accepted by Twilio (status = 'SENT')
 * but whose terminal status callbacks never arrived (e.g. dropped by network).
 * Actively fetches the call resource from Twilio and updates the attempt/notification state.
 */
export async function reconcileStaleVoiceCalls(
  now: Date = new Date(),
  limit = 20
): Promise<{ checked: number; reconciled: number }> {
  const credentials = await getTwilioVoiceCallbackCredentials();
  if (!credentials?.accountSid || !credentials.authToken) {
    return { checked: 0, reconciled: 0 };
  }

  const cutoff = new Date(now.getTime() - STALE_VOICE_CALL_AGE_MS);
  const staleNotifications = await prisma.notification.findMany({
    where: {
      channel: 'VOICE',
      status: 'SENT',
      providerMessageId: { not: null },
      createdAt: { lte: cutoff },
    },
    take: limit,
    select: {
      id: true,
      providerMessageId: true,
      maxAttempts: true,
      deliveryAttempts: {
        where: { outcome: { in: ['ACCEPTED', 'IN_FLIGHT'] } },
        orderBy: { ordinal: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  });

  if (staleNotifications.length === 0) {
    return { checked: 0, reconciled: 0 };
  }

  let factory: TwilioFactory;
  try {
    const imported = await import('twilio');
    factory = (imported.default || imported) as unknown as TwilioFactory;
  } catch {
    return { checked: 0, reconciled: 0 };
  }

  const client = factory(credentials.accountSid, credentials.authToken);
  let reconciled = 0;

  for (const notif of staleNotifications) {
    if (!notif.providerMessageId) continue;
    try {
      const call = await client.calls(notif.providerMessageId).fetch();
      const callStatus = (call.status || '').toLowerCase();
      const delivered = callStatus === 'answered' || callStatus === 'completed';
      const failed = ['busy', 'no-answer', 'failed', 'canceled'].includes(callStatus);

      if (delivered) {
        await prisma.$transaction(async tx => {
          await tx.notification.updateMany({
            where: { id: notif.id, status: 'SENT' },
            data: {
              status: 'DELIVERED',
              deliveredAt: now,
              errorMsg: null,
            },
          });
          const attemptId = notif.deliveryAttempts[0]?.id;
          if (attemptId) {
            await tx.notificationDeliveryAttempt.updateMany({
              where: { id: attemptId },
              data: {
                outcome: callStatus.toUpperCase(),
                finishedAt: now,
              },
            });
          }
        });
        reconciled++;
      } else if (failed) {
        await prisma.$transaction(async tx => {
          await tx.notification.updateMany({
            where: { id: notif.id, status: 'SENT' },
            data: {
              status: 'FAILED',
              attempts: notif.maxAttempts,
              failedAt: now,
              errorMsg: `Twilio voice call ${callStatus} (reconciled via polling)`,
            },
          });
          const attemptId = notif.deliveryAttempts[0]?.id;
          if (attemptId) {
            await tx.notificationDeliveryAttempt.updateMany({
              where: { id: attemptId },
              data: {
                outcome: callStatus.toUpperCase(),
                finishedAt: now,
                errorCode: callStatus,
                errorMessage: `Twilio voice call ${callStatus}`,
              },
            });
          }
        });
        reconciled++;
      }
    } catch (error) {
      logger.warn('voice.reconcile_call_fetch_failed', {
        notificationId: notif.id,
        callSid: notif.providerMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checked: staleNotifications.length, reconciled };
}
