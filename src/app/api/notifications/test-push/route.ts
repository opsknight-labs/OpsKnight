import { jsonError, jsonOk } from '@/lib/api-response';
import { getAuthOptions } from '@/lib/auth';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getPushConfig } from '@/lib/notification-providers';
import prisma from '@/lib/prisma';
import { notificationProviderUnavailable } from '@/lib/provider-errors';
import { sendPush } from '@/lib/push';
import { checkRateLimit } from '@/lib/rate-limit';
import { getServerSession } from 'next-auth';

export async function POST() {
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
          details: { provider: 'web-push', reason: 'not_configured' },
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
          details: { provider: 'web-push', reason: 'no_subscription' },
        })
      );
    }

    const result = await sendPush({
      userId: user.id,
      title: '🔔 OpsKnight Test Push',
      body: `Hey ${user.name || 'there'}! Your push notifications are working perfectly. ✅`,
      data: {
        url: '/m/notifications',
        type: 'test',
      },
      badge: 1,
    });

    if (!result.success) {
      const remainingDevices = await prisma.userDevice.count({
        where: { userId: user.id, platform: 'web' },
      });
      if (remainingDevices === 0) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'The saved push subscription is no longer valid.',
            action: 'Enable push notifications again on this device and retry.',
            retryable: false,
            details: { provider: 'web-push', reason: 'subscription_removed' },
          })
        );
      }

      return jsonError(
        notificationProviderUnavailable({
          provider: 'web-push',
          operation: 'send_test_push',
          cause: result.error ? new Error(result.error) : undefined,
        })
      );
    }

    return jsonOk(
      { success: true, message: 'Test notification sent successfully! Check your device.' },
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
