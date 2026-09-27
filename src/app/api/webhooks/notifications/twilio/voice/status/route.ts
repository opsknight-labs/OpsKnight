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
          finishedAt: true,
          outcome: true,
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
      // If the attempt is already in a terminal state (or finishedAt is set),
      // ignore subsequent status callbacks to enforce absolute terminal immutability.
      const TERMINAL_OUTCOMES = [
        'COMPLETED',
        'BUSY',
        'NO-ANSWER',
        'FAILED',
        'CANCELED',
        'ACKNOWLEDGED',
      ];
      if (attempt.finishedAt || TERMINAL_OUTCOMES.includes(attempt.outcome)) {
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
    // mutate the parent notification state OR the endpoint health accounting.
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
        // Record endpoint health only when this callback belongs to the current attempt
        // (guarded by !newerAttempt above). A stale "failed" callback for a superseded
        // attempt can no longer degrade a healthy phone endpoint.
        if (notification.userId) {
          await recordUserNotificationEndpointOutcome(tx, {
            userId: notification.userId,
            channel: 'VOICE',
            addressHash: notification.recipientHash,
            delivered: true,
            occurredAt: now,
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
        // Only mark endpoint degraded for actual technical/provider failures,
        // NOT for human non-responsiveness (busy, no-answer, canceled).
        // Also guarded by !newerAttempt: a late failure from a superseded attempt
        // cannot mark an endpoint degraded after a successful retry.
        if (notification.userId && callStatus === 'failed') {
          await recordUserNotificationEndpointOutcome(tx, {
            userId: notification.userId,
            channel: 'VOICE',
            addressHash: notification.recipientHash,
            delivered: false,
            errorCode: callStatus,
            occurredAt: now,
          });
        }
      } else {
        await tx.notification.updateMany({
          where: { id: notification.id, status: { in: ['PENDING', 'UNKNOWN'] } },
          data: { status: 'SENT', errorMsg: null },
        });
      }
    }

    // Monotonic transition rank and CAS state machine for delivery attempts:
    // Rank 0: IN_FLIGHT
    // Rank 1: ACCEPTED
    // Rank 2: RINGING
    // Rank 3: IN-PROGRESS / ANSWERED
    // Rank 4: Terminal states (COMPLETED, BUSY, NO-ANSWER, FAILED, CANCELED, ACKNOWLEDGED)
    //
    // Transitions can ONLY move forward in rank, and ANY attempt with finishedAt != null
    // or an existing terminal outcome is completely immutable.
    // NOTE: The attempt state machine runs regardless of newerAttempt so that even a
    // stale callback still advances its OWN attempt record monotonically.
    let targetOutcome: string;
    let allowedPreviousOutcomes: string[];

    if (completed) {
      targetOutcome = 'COMPLETED';
      // Completed can only transition from active, non-terminal states
      allowedPreviousOutcomes = ['IN_FLIGHT', 'ACCEPTED', 'RINGING', 'IN-PROGRESS', 'ANSWERED'];
    } else if (connected) {
      targetOutcome = callStatus === 'in-progress' ? 'IN-PROGRESS' : 'ANSWERED';
      // Connected can only transition from pre-connection states
      allowedPreviousOutcomes = ['IN_FLIGHT', 'ACCEPTED', 'RINGING'];
    } else if (failed) {
      targetOutcome = callStatus.toUpperCase();
      // Human/network terminal failures can only transition from pre-connection states
      allowedPreviousOutcomes = ['IN_FLIGHT', 'ACCEPTED', 'RINGING'];
    } else {
      targetOutcome = callStatus === 'ringing' ? 'RINGING' : 'ACCEPTED';
      // Ringing can only transition from initial dispatch states
      allowedPreviousOutcomes = ['IN_FLIGHT', 'ACCEPTED'];
    }

    const attemptFilter = attempt?.id
      ? { id: attempt.id }
      : { notificationId: notification.id, providerMessageId: callSid };

    await tx.notificationDeliveryAttempt.updateMany({
      where: {
        ...attemptFilter,
        finishedAt: null,
        outcome: { in: allowedPreviousOutcomes },
      },
      data: {
        outcome: targetOutcome,
        ...(completed || failed ? { finishedAt: now } : {}),
        ...(failed
          ? { errorCode: callStatus, errorMessage: `Twilio voice call ${callStatus}` }
          : {}),
      },
    });
  });
  return new NextResponse(null, { status: 204 });
}
