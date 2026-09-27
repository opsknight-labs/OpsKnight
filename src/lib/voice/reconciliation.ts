import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getTwilioVoiceCallbackCredentials } from '@/lib/notification-providers';

type TwilioCall = { sid: string; status: string };
type TwilioClient = { calls: (sid: string) => { fetch: () => Promise<TwilioCall> } };
type TwilioFactory = (accountSid: string, authToken: string) => TwilioClient;

const STALE_VOICE_CALL_AGE_MS = 3 * 60_000; // 3 minutes
const RECONCILIATION_LEASE_MS = 60_000; // 60 seconds lease cooldown

// Active (non-terminal) attempt outcomes that the reconciler is responsible for closing.
// DELIVERED notifications with an attempt in one of these states are included in the scan
// so that a lost "completed" webhook does not leave the delivery ledger permanently open.
const OPEN_VOICE_OUTCOMES = [
  'ACCEPTED',
  'IN_FLIGHT',
  'RINGING',
  'IN-PROGRESS',
  'ANSWERED',
] as const;

/**
 * Reconciles voice calls that were accepted by Twilio but whose terminal status
 * callbacks never arrived (e.g. dropped by network or load balancer).
 *
 * Scans both SENT and DELIVERED notifications:
 *  - SENT:      call accepted, but no in-progress/completed webhook arrived yet.
 *  - DELIVERED: call went in-progress (notification promoted to DELIVERED), but the
 *               final "completed" callback was lost — attempt stays IN-PROGRESS forever
 *               without this path.
 *
 * Uses a CAS lease on Notification.reconciliationDeadline to prevent stampeding
 * across workers/replicas (HA-safe).
 *
 * For in-progress calls, the lease is re-scheduled rather than cleared, so the
 * next reconciliation tick will continue polling until Twilio returns a terminal state.
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

  // Scan both SENT (webhook never arrived) and DELIVERED (in-progress → completed webhook lost).
  // The deliveryAttempts sub-filter is a performance guard: only fetch notifications that
  // actually have an open attempt (uses the partial index idx_attempt_open_voice).
  const staleNotifications = await prisma.notification.findMany({
    where: {
      channel: 'VOICE',
      status: { in: ['SENT', 'DELIVERED'] },
      createdAt: { lte: cutoff },
      OR: [{ reconciliationDeadline: null }, { reconciliationDeadline: { lte: now } }],
      // Only include notifications that have at least one open attempt.
      // This avoids fetching DELIVERED notifications that already have a closed attempt
      // (e.g. properly COMPLETED via webhook), keeping the scan lean in production.
      deliveryAttempts: {
        some: {
          outcome: { in: [...OPEN_VOICE_OUTCOMES] },
          finishedAt: null,
        },
      },
    },
    take: limit,
    select: {
      id: true,
      status: true,
      providerMessageId: true,
      maxAttempts: true,
      deliveryAttempts: {
        where: { outcome: { in: [...OPEN_VOICE_OUTCOMES] }, finishedAt: null },
        orderBy: { ordinal: 'desc' },
        take: 1,
        select: { id: true, providerMessageId: true },
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
  let checked = 0;

  for (const notif of staleNotifications) {
    const callSid = notif.deliveryAttempts[0]?.providerMessageId || notif.providerMessageId;
    if (!callSid) continue;

    const leaseExpiry = new Date(now.getTime() + RECONCILIATION_LEASE_MS);

    // HA CAS lease: claim this notification for reconciliation.
    // The where clause accepts both SENT and DELIVERED so the update succeeds
    // regardless of which state the notification is currently in.
    const claimed = await prisma.notification.updateMany({
      where: {
        id: notif.id,
        status: { in: ['SENT', 'DELIVERED'] },
        OR: [{ reconciliationDeadline: null }, { reconciliationDeadline: { lte: now } }],
      },
      data: {
        reconciliationDeadline: leaseExpiry,
      },
    });
    if (claimed.count === 0) continue; // another worker claimed it first
    checked++;

    try {
      const call = await client.calls(callSid).fetch();
      const callStatus = (call.status || '').toLowerCase();
      const isInProgress = callStatus === 'in-progress' || callStatus === 'answered';
      const isCompleted = callStatus === 'completed';
      const isFailed = ['busy', 'no-answer', 'failed', 'canceled'].includes(callStatus);

      if (isInProgress) {
        // The call is still in progress — the notification should be DELIVERED and the
        // attempt should reflect the current Twilio state.
        // Do NOT clear reconciliationDeadline: re-schedule for the next poll tick so
        // we keep checking until Twilio returns a terminal state.
        // This is the key fix for the P1/P2 issue: a DELIVERED notification with an
        // open IN-PROGRESS attempt will be continuously re-polled.
        const nextPollDeadline = new Date(now.getTime() + RECONCILIATION_LEASE_MS);
        await prisma.$transaction(async tx => {
          await tx.notification.updateMany({
            where: { id: notif.id, status: 'SENT' },
            data: {
              status: 'DELIVERED',
              deliveredAt: now,
              errorMsg: null,
              // Re-schedule next poll — do not null out reconciliationDeadline.
              reconciliationDeadline: nextPollDeadline,
            },
          });
          // If already DELIVERED, just refresh the lease for the next poll.
          await tx.notification.updateMany({
            where: { id: notif.id, status: 'DELIVERED' },
            data: { reconciliationDeadline: nextPollDeadline },
          });
          const attemptId = notif.deliveryAttempts[0]?.id;
          if (attemptId) {
            await tx.notificationDeliveryAttempt.updateMany({
              where: {
                id: attemptId,
                finishedAt: null,
                outcome: { in: [...OPEN_VOICE_OUTCOMES] },
              },
              data: {
                outcome: callStatus === 'answered' ? 'ANSWERED' : 'IN-PROGRESS',
                // finishedAt remains null — call is still active
              },
            });
          }
        });
        reconciled++;
      } else if (isCompleted) {
        // Terminal success: close the attempt and the notification.
        await prisma.$transaction(async tx => {
          await tx.notification.updateMany({
            where: { id: notif.id, status: { in: ['SENT', 'DELIVERED'] } },
            data: {
              status: 'DELIVERED',
              deliveredAt: now,
              errorMsg: null,
              reconciliationDeadline: null,
            },
          });
          const attemptId = notif.deliveryAttempts[0]?.id;
          if (attemptId) {
            await tx.notificationDeliveryAttempt.updateMany({
              where: {
                id: attemptId,
                finishedAt: null,
                outcome: { in: [...OPEN_VOICE_OUTCOMES] },
              },
              data: {
                outcome: 'COMPLETED',
                finishedAt: now,
              },
            });
          }
        });
        reconciled++;
      } else if (isFailed) {
        // Terminal failure: close the attempt and mark notification FAILED.
        await prisma.$transaction(async tx => {
          await tx.notification.updateMany({
            where: { id: notif.id, status: { in: ['SENT', 'DELIVERED'] } },
            data: {
              status: 'FAILED',
              attempts: notif.maxAttempts,
              failedAt: now,
              errorMsg: `Twilio voice call ${callStatus} (reconciled via polling)`,
              reconciliationDeadline: null,
            },
          });
          const attemptId = notif.deliveryAttempts[0]?.id;
          if (attemptId) {
            await tx.notificationDeliveryAttempt.updateMany({
              where: {
                id: attemptId,
                finishedAt: null,
                outcome: { in: ['ACCEPTED', 'IN_FLIGHT', 'RINGING', 'IN-PROGRESS', 'ANSWERED'] },
              },
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
      // If Twilio returns an unknown or transient state (e.g. 'queued', 'ringing'),
      // do nothing — the lease will expire naturally and the next poll will re-evaluate.
    } catch (error) {
      logger.warn('voice.reconcile_call_fetch_failed', {
        notificationId: notif.id,
        callSid,
        error: error instanceof Error ? error.message : String(error),
      });
      // On fetch failure, leave reconciliationDeadline as the lease expiry so that
      // another worker or the next tick will retry. This is safe because the CAS
      // lease prevents stampeding.
    }
  }

  return { checked, reconciled };
}
