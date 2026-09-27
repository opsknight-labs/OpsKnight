import { NextRequest, NextResponse } from 'next/server';
import { jsonError } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-url';
import { readIntegrationBody } from '@/lib/integrations/request-security';
import { logger } from '@/lib/logger';
import { getTwilioVoiceCallbackCredentials } from '@/lib/notification-providers';
import { validateTwilioRequest } from '@/lib/twilio/signature';
import { recordUserNotificationEndpointOutcome } from '@/lib/user-notification-endpoints';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await readIntegrationBody(request, 64 * 1024);
    const params = new URLSearchParams(rawBody);
    const credentials = await getTwilioVoiceCallbackCredentials();
    const appUrl = await getAppUrl();
    const callbackUrl = `${appUrl}${request.nextUrl.pathname}${request.nextUrl.search}`;
    if (
      !credentials?.authToken ||
      !validateTwilioRequest(
        callbackUrl,
        params,
        request.headers.get('x-twilio-signature') || '',
        credentials.authToken
      )
    ) {
      return jsonError('Invalid Twilio signature', 401);
    }

    const notificationId = request.nextUrl.searchParams.get('notificationId');
    const attemptId =
      request.nextUrl.searchParams.get('attemptId') ||
      request.nextUrl.searchParams.get('deliveryAttemptId');
    const callSid = params.get('CallSid');
    const callStatus = (params.get('CallStatus') || '').toLowerCase();
    if (!notificationId || !callSid) {
      return jsonError('Notification ID and Call SID are required', 400);
    }

    // When an attemptId is provided, use attempt-level correlation.
    // The callback must match the exact delivery attempt to prevent a stale
    // retry callback from hijacking a notification.
    if (attemptId) {
      const attempt = await prisma.notificationDeliveryAttempt.findUnique({
        where: { id: attemptId },
        select: {
          id: true,
          notificationId: true,
          providerMessageId: true,
          startedAt: true,
          notification: {
            select: {
              id: true,
              status: true,
              maxAttempts: true,
              incidentId: true,
              userId: true,
              user: { select: { name: true } },
              recipientHash: true,
            },
          },
        },
      });
      if (!attempt || attempt.notificationId !== notificationId) {
        return new NextResponse(null, { status: 204 });
      }
      // Verify the Call SID matches this attempt. If the attempt has no provider
      // message ID yet, atomically bind it to this attempt; otherwise reject mismatches.
      if (attempt.providerMessageId && attempt.providerMessageId !== callSid) {
        return new NextResponse(null, { status: 204 });
      }
      if (!attempt.providerMessageId) {
        const bound = await prisma.notificationDeliveryAttempt.updateMany({
          where: { id: attemptId, providerMessageId: null },
          data: { providerMessageId: callSid },
        });
        if (bound.count === 0) return new NextResponse(null, { status: 204 });
      }
      return processStatusCallback(attempt.notification, callSid, callStatus, attempt);
    }

    // Legacy path: notification-level lookup for backwards compatibility with
    // in-flight calls that were initiated before the attempt-level migration.
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, channel: 'VOICE' },
      select: {
        id: true,
        status: true,
        maxAttempts: true,
        providerMessageId: true,
        incidentId: true,
        userId: true,
        user: { select: { name: true } },
        recipientHash: true,
      },
    });
    if (!notification) return jsonError('Notification not found', 404);
    if (notification.providerMessageId && notification.providerMessageId !== callSid) {
      return new NextResponse(null, { status: 204 });
    }
    return processStatusCallback(notification, callSid, callStatus);
  } catch (error) {
    logger.error('voice.twilio_status_failed', { error });
    return jsonError('Failed to process voice status', 500);
  }
}

async function processStatusCallback(
  notification: {
    id: string;
    status: string;
    maxAttempts: number;
    incidentId: string | null;
    userId: string | null;
    user: { name: string | null } | null;
    recipientHash: string | null;
  },
  callSid: string,
  callStatus: string,
  attempt?: { id: string; startedAt: Date }
) {
  // Twilio's answered progress event sends CallStatus = 'in-progress'
  const connected = callStatus === 'in-progress' || callStatus === 'answered';
  const completed = callStatus === 'completed';
  const delivered = connected || completed;
  const failed = ['busy', 'no-answer', 'failed', 'canceled'].includes(callStatus);
  const now = new Date();
  await prisma.$transaction(async tx => {
    // If a newer attempt exists, this callback is for a stale attempt and must NOT
    // mutate the parent notification state.
    const newerAttempt =
      attempt?.startedAt && tx.notificationDeliveryAttempt?.findFirst
        ? await tx.notificationDeliveryAttempt.findFirst({
            where: {
              notificationId: notification.id,
              id: { not: attempt.id },
              startedAt: { gt: attempt.startedAt },
            },
            select: { id: true },
          })
        : null;

    if (!newerAttempt) {
      if (delivered) {
        const changed = await tx.notification.updateMany({
          where: { id: notification.id, status: { in: ['PENDING', 'SENT', 'UNKNOWN'] } },
          data: {
            status: 'DELIVERED',
            deliveredAt: now,
            failedAt: null,
            errorMsg: null,
            reconciliationDeadline: null,
          },
        });
        if (changed.count > 0 && connected && notification.incidentId) {
          await tx.incidentEvent.create({
            data: {
              incidentId: notification.incidentId,
              type: 'STATUS_CHANGE',
              message: `Voice call connected to ${notification.user?.name || 'responder'}`,
            },
          });
        }
      } else if (failed && notification.status !== 'DELIVERED') {
        await tx.notification.updateMany({
          where: { id: notification.id, status: { in: ['PENDING', 'SENT', 'UNKNOWN'] } },
          data: {
            status: 'FAILED',
            attempts: notification.maxAttempts,
            failedAt: now,
            errorMsg: `Twilio voice call ${callStatus}`,
            reconciliationDeadline: null,
          },
        });
      } else {
        await tx.notification.updateMany({
          where: { id: notification.id, status: { in: ['PENDING', 'UNKNOWN'] } },
          data: { status: 'SENT', errorMsg: null },
        });
      }
    }

    // Monotonic state machine for delivery attempts:
    // ACCEPTED (1) -> RINGING (2) -> IN-PROGRESS / ANSWERED (3) -> terminal states (COMPLETED, BUSY, NO-ANSWER, FAILED, CANCELED, ACKNOWLEDGED) (4)
    const TERMINAL_OUTCOMES = [
      'COMPLETED',
      'BUSY',
      'NO-ANSWER',
      'FAILED',
      'CANCELED',
      'ACKNOWLEDGED',
    ];
    const CONNECTED_OUTCOMES = ['IN-PROGRESS', 'ANSWERED', 'COMPLETED', 'ACKNOWLEDGED'];

    let targetOutcome: string;
    let whereOutcomeCondition: object = {};

    if (completed) {
      targetOutcome = 'COMPLETED';
      whereOutcomeCondition = { outcome: { not: 'ACKNOWLEDGED' } };
    } else if (connected) {
      targetOutcome = callStatus === 'in-progress' ? 'IN-PROGRESS' : 'ANSWERED';
      whereOutcomeCondition = { outcome: { notIn: ['COMPLETED', 'ACKNOWLEDGED'] } };
    } else if (failed) {
      targetOutcome = callStatus.toUpperCase();
      // A failed callback must never overwrite an attempt that was already connected or completed
      whereOutcomeCondition = { outcome: { notIn: CONNECTED_OUTCOMES } };
    } else {
      targetOutcome = callStatus === 'ringing' ? 'RINGING' : 'ACCEPTED';
      // Ringing/initiated must never overwrite connected or terminal states
      whereOutcomeCondition = { outcome: { notIn: [...CONNECTED_OUTCOMES, ...TERMINAL_OUTCOMES] } };
    }

    const attemptFilter = attempt?.id
      ? { id: attempt.id }
      : { notificationId: notification.id, providerMessageId: callSid };

    await tx.notificationDeliveryAttempt.updateMany({
      where: {
        ...attemptFilter,
        ...whereOutcomeCondition,
      },
      data: {
        outcome: targetOutcome,
        ...(completed || failed ? { finishedAt: now } : {}),
        ...(failed
          ? { errorCode: callStatus, errorMessage: `Twilio voice call ${callStatus}` }
          : {}),
      },
    });

    if (notification.userId) {
      if (delivered) {
        await recordUserNotificationEndpointOutcome(tx, {
          userId: notification.userId,
          channel: 'VOICE',
          addressHash: notification.recipientHash,
          delivered: true,
          occurredAt: now,
        });
      } else if (failed && callStatus === 'failed') {
        // Only mark endpoint degraded for actual technical/provider failures,
        // NOT for human non-responsiveness (busy, no-answer, canceled).
        await recordUserNotificationEndpointOutcome(tx, {
          userId: notification.userId,
          channel: 'VOICE',
          addressHash: notification.recipientHash,
          delivered: false,
          errorCode: callStatus,
          occurredAt: now,
        });
      }
    }
  });
  return new NextResponse(null, { status: 204 });
}
