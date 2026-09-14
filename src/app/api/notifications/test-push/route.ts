import crypto from 'crypto';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getAuthOptions } from '@/lib/auth';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getPushConfig } from '@/lib/notification-providers';
import prisma from '@/lib/prisma';
import { notificationProviderUnavailable } from '@/lib/provider-errors';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import { checkRateLimit } from '@/lib/rate-limit';
import { webPushDeviceKey } from '@/lib/web-push-subscription';
import { getServerSession } from 'next-auth';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) {
      return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true },
    });

    if (!user) {
      return jsonError(
        new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: 'The current user could not be found.',
        })
      );
    }

    const rateLimit = await checkRateLimit(`test-push:${user.id}`, 5, 60_000);
    if (!rateLimit.allowed) {
      const retryAfter = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
      return jsonError(
        new AppError({
          code: 'RATE_LIMIT_EXCEEDED',
          userMessage: 'Please wait a moment before sending another test notification.',
        }),
        undefined,
        { retryAfter }
      );
    }

    // Require the calling device's push endpoint so the test targets
    // exactly that device rather than blasting all user subscriptions.
    let body: { endpoint?: string } = {};
    const text = await request.text();
    if (text && text.trim().length > 0) {
      try {
        body = JSON.parse(text) as { endpoint?: string };
      } catch {
        return jsonError(
          new AppError({
            code: 'INVALID_JSON',
            userMessage: 'The request payload contains invalid JSON.',
            retryable: false,
          }),
          400
        );
      }
    } else {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Test push requires a valid device subscription endpoint.',
          action: 'Enable push notifications on this device, then try again.',
          retryable: false,
          details: { reason: 'PUSH_NO_SUBSCRIPTION' },
        }),
        400
      );
    }

    if (
      !body.endpoint ||
      typeof body.endpoint !== 'string' ||
      !body.endpoint.startsWith('https://')
    ) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'A valid HTTPS push subscription endpoint is required.',
          action: 'Enable push notifications on this device, then try again.',
          retryable: false,
          details: { reason: 'PUSH_NO_SUBSCRIPTION' },
        }),
        400
      );
    }

    const [pushConfig, deviceCount] = await Promise.all([
      getPushConfig(),
      prisma.userDevice.count({ where: { userId: user.id, platform: 'web' } }),
    ]);

    if (!pushConfig.enabled || pushConfig.provider !== 'web-push') {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Push notifications are not configured.',
          action: 'Configure Web Push before sending a test notification.',
          retryable: false,
          details: { provider: 'web-push', reason: 'PUSH_VAPID_NOT_CONFIGURED' },
        })
      );
    }

    if (deviceCount === 0) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'No active web push subscription is available for this user.',
          action: 'Enable push notifications on a device, then try again.',
          retryable: false,
          details: { provider: 'web-push', reason: 'PUSH_NO_SUBSCRIPTION' },
        })
      );
    }

    // Validate the endpoint belongs to this user and use its device ID as target
    const deviceKey = webPushDeviceKey(body.endpoint);
    const device = await prisma.userDevice.findFirst({
      where: { userId: user.id, deviceId: deviceKey, platform: 'web' },
      select: { id: true, deviceId: true },
    });
    if (!device) {
      logger.warn('api.test_push.device_not_found', {
        userId: user.id,
        deviceKey,
      });
      return jsonError(
        new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: 'The specified push subscription does not belong to this account.',
          action: 'Re-enable push notifications on this device.',
          retryable: false,
          details: { reason: 'PUSH_NO_SUBSCRIPTION' },
        }),
        404
      );
    }
    const targetDeviceId = device.deviceId;

    const result = await enqueueCentralNotification({
      category: 'SYSTEM',
      channel: 'PUSH',
      recipientType: 'USER',
      recipientId: user.id,
      recipientAddress: user.id,
      userId: user.id,
      templateKey: 'test-push',
      sourceType: 'USER',
      sourceId: user.id,
      // Each rate-limited user action is intentionally a distinct delivery request.
      eventKey: `manual-test:${crypto.randomUUID()}`,
      displayMessage: 'Test push notification',
      // TRANSACTIONAL: bypass bulk queues so a test push is never deferred by
      // thousands of queued bulk notifications. Priority 1 = highest urgency.
      trafficClass: 'TRANSACTIONAL',
      priority: 1,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      payload: {
        kind: 'PUSH',
        userId: user.id,
        title: '🔔 OpsKnight Test Push',
        body: `Hey ${user.name || 'there'}! Your push notifications are working perfectly. ✅`,
        data: {
          url: '/m/notifications',
          type: 'test',
        },
        badge: 1,
        targetDeviceId,
      },
    });

    if (!result.delivered) {
      const targetDeviceStillExists = await prisma.userDevice.findFirst({
        where: { userId: user.id, deviceId: targetDeviceId, platform: 'web' },
        select: { id: true },
      });
      if (!targetDeviceStillExists) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'The saved push subscription on this device has expired.',
            action: 'Enable push notifications again on this device and retry.',
            retryable: false,
            details: {
              provider: 'web-push',
              reason: 'PUSH_SUBSCRIPTION_EXPIRED',
              targetDeviceId,
            },
          }),
          410
        );
      }

      return jsonError(
        new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage: 'Push notification delivery failed for this device.',
          action: 'Please try again shortly.',
          retryable: true,
          details: {
            provider: 'web-push',
            reason: 'PUSH_PROVIDER_UNAVAILABLE',
            targetedDevice: targetDeviceId,
          },
        })
      );
    }

    return jsonOk(
      {
        success: true,
        message: 'Test notification sent successfully! Check your device.',
        targetedDevice: targetDeviceId ?? 'all',
      },
      200
    );
  } catch (error) {
    logger.error('api.notifications.test_push_error', {
      error,
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    });
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to send test push', 500);
  }
}
