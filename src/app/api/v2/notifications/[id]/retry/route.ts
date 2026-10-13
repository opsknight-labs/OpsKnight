import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requeueCentralNotification } from '@/lib/notification-control-plane';
import { AppError } from '@/lib/errors';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.NOTIFICATION_MANAGE);

    const { id } = await params;
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { id: true, status: true, channel: true },
    });

    if (!notification) {
      throw new AppError({
        code: 'NOTIFICATION_NOT_FOUND',
        userMessage: `Notification with id '${id}' was not found.`,
      });
    }

    if (notification.status !== 'FAILED') {
      throw new AppError({
        code: 'NOTIFICATION_NOT_RETRYABLE',
        userMessage: `Notification '${id}' is in status '${notification.status}' and cannot be retried. Only FAILED notifications can be retried.`,
      });
    }

    const requeued = await requeueCentralNotification(id);
    if (!requeued) {
      throw new AppError({
        code: 'NOTIFICATION_RETRY_FAILED',
        userMessage: `Notification '${id}' failed to be requeued for delivery.`,
      });
    }

    await logV2Audit({
      action: 'notification.retry_requested',
      entityType: 'SYSTEM_CONFIG',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { channel: notification.channel },
    });

    return apiV2Success({ success: true, message: `Notification '${id}' scheduled for retry.` }, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
