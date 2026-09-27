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
    const callSid = params.get('CallSid');
    const callStatus = (params.get('CallStatus') || '').toLowerCase();
    if (!notificationId || !callSid) {
      return jsonError('Notification ID and Call SID are required', 400);
    }
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
              message: `Voice call answered by ${notification.user?.name || 'responder'}`,
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
      await tx.notificationDeliveryAttempt.updateMany({
        where: { notificationId: notification.id, providerMessageId: callSid },
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
  } catch (error) {
    logger.error('voice.twilio_status_failed', { error });
    return jsonError('Failed to process voice status', 500);
  }
}
