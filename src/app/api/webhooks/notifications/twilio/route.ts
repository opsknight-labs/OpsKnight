import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBaseUrl } from '@/lib/env-validation';
import { getSMSConfig, getWhatsAppConfig } from '@/lib/notification-providers';
import { readIntegrationBody } from '@/lib/integrations/request-security';
import { logger } from '@/lib/logger';

function validTwilioSignature(
  url: string,
  params: URLSearchParams,
  signature: string,
  authToken: string
): boolean {
  const sorted = Array.from(params.keys())
    .sort()
    .map(key => `${key}${params.get(key) || ''}`)
    .join('');
  const expected = createHmac('sha1', authToken).update(`${url}${sorted}`).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await readIntegrationBody(request, 64 * 1024);
    const params = new URLSearchParams(rawBody);
    const signature = request.headers.get('x-twilio-signature') || '';
    const callbackUrl = `${getBaseUrl()}${request.nextUrl.pathname}${request.nextUrl.search}`;
    const [smsConfig, whatsappConfig] = await Promise.all([getSMSConfig(), getWhatsAppConfig()]);
    const authTokens = [smsConfig.authToken, whatsappConfig.authToken].filter(
      (token): token is string => Boolean(token)
    );

    if (
      !signature ||
      !authTokens.some(token => validTwilioSignature(callbackUrl, params, signature, token))
    ) {
      return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 401 });
    }

    const notificationId = request.nextUrl.searchParams.get('notificationId');
    const messageSid = params.get('MessageSid');
    const messageStatus = (params.get('MessageStatus') || '').toLowerCase();
    if (!notificationId && !messageSid) {
      return NextResponse.json({ error: 'Notification identifier is required' }, { status: 400 });
    }

    const notification = await prisma.notification.findFirst({
      where: {
        OR: [
          ...(notificationId ? [{ id: notificationId }] : []),
          ...(messageSid ? [{ providerMessageId: messageSid }] : []),
        ],
      },
      select: { id: true, status: true, providerMessageId: true },
    });
    if (!notification) {
      logger.warn('twilio.dlr_notification_not_found', { notificationId, messageSid });
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    // A receipt for an older provider attempt must never overwrite a newer attempt.
    if (
      messageSid &&
      notification.providerMessageId &&
      notification.providerMessageId !== messageSid
    ) {
      logger.info('twilio.dlr_stale_provider_attempt_ignored', {
        notificationId: notification.id,
        messageSid,
      });
      return new NextResponse(null, { status: 204 });
    }
    const providerAttemptFence = messageSid
      ? { OR: [{ providerMessageId: null }, { providerMessageId: messageSid }] }
      : { providerMessageId: null };

    const delivered = messageStatus === 'delivered' || messageStatus === 'read';
    const failed =
      messageStatus === 'failed' || messageStatus === 'undelivered' || messageStatus === 'canceled';

    if (delivered) {
      if (notification.status !== 'DELIVERED') {
        await prisma.notification.updateMany({
          where: {
            id: notification.id,
            status: { in: ['PENDING', 'SENT', 'FAILED'] },
            ...providerAttemptFence,
          },
          data: {
            providerMessageId: messageSid || undefined,
            status: 'DELIVERED',
            deliveredAt: new Date(),
            failedAt: null,
            errorMsg: null,
          },
        });
      }
    } else if (failed) {
      // DELIVERED is terminal-successful and must not regress because of a late callback.
      if (notification.status !== 'DELIVERED' && notification.status !== 'FAILED') {
        await prisma.notification.updateMany({
          where: {
            id: notification.id,
            status: { in: ['PENDING', 'SENT'] },
            ...providerAttemptFence,
          },
          data: {
            providerMessageId: messageSid || undefined,
            status: 'FAILED',
            failedAt: new Date(),
            deliveredAt: null,
            errorMsg:
              params.get('ErrorMessage') ||
              `Twilio delivery failed (${params.get('ErrorCode') || 'unknown'})`,
            attempts: { increment: 1 },
          },
        });
      }
    } else if (notification.status !== 'DELIVERED' && notification.status !== 'FAILED') {
      await prisma.notification.updateMany({
        where: {
          id: notification.id,
          status: 'PENDING',
          ...providerAttemptFence,
        },
        data: {
          providerMessageId: messageSid || undefined,
          status: 'SENT',
          errorMsg: null,
        },
      });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error('twilio.dlr_failed', { error });
    return NextResponse.json({ error: 'Failed to process delivery receipt' }, { status: 500 });
  }
}
