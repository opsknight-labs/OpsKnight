import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger, withRequestContext } from '@/lib/logger';
import { AppError, isAppError } from '@/lib/errors';
import { jsonError, jsonOk } from '@/lib/api-response';
import { webPushDeviceKey } from '@/lib/web-push-subscription';

const SubscriptionStatusSchema = z
  .object({
    endpoint: z.string().url().max(4096).optional(),
  })
  .strict();

async function authenticatedUserId() {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.id) throw new AppError({ code: 'AUTHENTICATION_REQUIRED' });
  return session.user.id;
}

async function checkStatus(req: NextRequest) {
  try {
    const userId = await authenticatedUserId();
    let body: unknown = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        throw new AppError({ code: 'INVALID_JSON' });
      }
    }
    const parsed = SubscriptionStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        fields: parsed.error.issues.map(issue => ({
          field: issue.path.join('.') || 'request',
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    const endpoint = parsed.data.endpoint;
    const [user, totalDevices] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { pushNotificationsEnabled: true },
      }),
      prisma.userDevice.count({ where: { userId, platform: 'web' } }),
    ]);

    let deviceRegistered = false;
    if (endpoint) {
      const deviceId = webPushDeviceKey(endpoint);
      const device = await prisma.userDevice.findFirst({
        where: {
          userId,
          deviceId: { in: [deviceId, endpoint] },
        },
        select: { id: true },
      });
      deviceRegistered = Boolean(device);
    }

    return jsonOk({
      accountEnabled: user?.pushNotificationsEnabled ?? false,
      deviceRegistered,
      totalDevices,
    });
  } catch (error) {
    logger.error('push.subscription.status_check_failed', {
      component: 'push-subscription-status-api',
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'unknown',
    });
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR' }));
  }
}

export const POST = withRequestContext(checkStatus, 'api.user.push-subscription.status');
