import { NextRequest, NextResponse } from 'next/server';
import { jsonError } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import { getBaseUrl } from '@/lib/env-validation';
import { readIntegrationBody } from '@/lib/integrations/request-security';
import { logger } from '@/lib/logger';
import { getVoiceConfig } from '@/lib/notification-providers';
import { validateTwilioRequest } from '@/lib/twilio/signature';
import { recordUserNotificationEndpointOutcome } from '@/lib/user-notification-endpoints';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await readIntegrationBody(request, 64 * 1024);
    const params = new URLSearchParams(rawBody);
    const config = await getVoiceConfig();
    const callbackUrl = `${getBaseUrl()}${request.nextUrl.pathname}${request.nextUrl.search}`;
    if (
      !config.authToken ||
      !validateTwilioRequest(
        callbackUrl,
        params,
        request.headers.get('x-twilio-signature') || '',
        config.authToken
      )
    ) {
      return jsonError('Invalid Twilio signature', 401);
    }

    const notificationId = request.nextUrl.searchParams.get('notificationId');
    const attemptId = request.nextUrl.searchParams.get('attemptId');
    const callSid = params.get('CallSid');
    const callStatus = (params.get('CallStatus') || '').toLowerCase();
    if (!notificationId || !callSid) {
      return jsonError('Notification ID and Call SID are required', 400);
    }

    // When an attemptId is provided, use attempt-level correlation.
    // The callback must match the exact delivery attempt to prevent a stale
    // retry callback from hijacking a notification via a null providerMessageId.
    if (attemptId) {
      const attempt = await prisma.notificationDeliveryAttempt.findUnique({
        where: { id: attemptId },
        select: {
          id: true,
          notificationId: true,
          providerMessageId: true,
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
      // message ID yet, atomically bind it; otherwise reject mismatches.
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
      const notification = attempt.notification;
      return processStatusCallback(notification, callSid, callStatus, attemptId);
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
  attemptId?: string
) {
  const delivered = callStatus === 'answered' || callStatus === 'completed';
  const failed = ['busy', 'no-answer', 'failed', 'canceled'].includes(callStatus);
  const now = new Date();
  await prisma.$transaction(async tx => {
    if (delivered) {
      const changed = await tx.notification.updateMany({
        where: { id: notification.id, status: { in: ['PENDING', 'SENT', 'UNKNOWN'] } },
        data: {
          providerMessageId: callSid,
          status: 'DELIVERED',
          deliveredAt: now,
          failedAt: null,
          errorMsg: null,
          reconciliationDeadline: null,
        },
      });
      if (changed.count > 0 && callStatus === 'answered' && notification.incidentId) {
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
          providerMessageId: callSid,
          status: 'FAILED',
          attempts: notification.maxAttempts,
          failedAt: now,
          errorMsg: `Twilio voice call ${callStatus}`,
          reconciliationDeadline: null,
        },
      });
    } else {
      await tx.notification.updateMany({
        where: { id: notification.id, status: { in: ['PENDING', 'SENT', 'UNKNOWN'] } },
        data: { providerMessageId: callSid, status: 'SENT', errorMsg: null },
      });
    }

    // Update the specific delivery attempt if we have an attemptId, otherwise
    // fall back to matching by providerMessageId for legacy in-flight calls.
    const attemptFilter = attemptId
      ? { id: attemptId }
      : { notificationId: notification.id, providerMessageId: callSid };
    await tx.notificationDeliveryAttempt.updateMany({
      where: attemptFilter,
      data: {
        outcome: delivered
          ? callStatus.toUpperCase()
          : failed
            ? callStatus.toUpperCase()
            : 'ACCEPTED',
        ...(delivered || failed ? { finishedAt: now } : {}),
        ...(failed
          ? { errorCode: callStatus, errorMessage: `Twilio voice call ${callStatus}` }
          : {}),
      },
    });
    if (notification.userId && (delivered || failed)) {
      await recordUserNotificationEndpointOutcome(tx, {
        userId: notification.userId,
        channel: 'VOICE',
        addressHash: notification.recipientHash,
        delivered,
        errorCode: failed ? callStatus : undefined,
        occurredAt: now,
      });
    }
  });
  return new NextResponse(null, { status: 204 });
}
