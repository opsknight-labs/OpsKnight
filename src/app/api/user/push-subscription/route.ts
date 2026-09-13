import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger, withRequestContext } from '@/lib/logger';
import { AppError, isAppError } from '@/lib/errors';
import { jsonError, jsonOk } from '@/lib/api-response';
import {
  WebPushSubscriptionSchema,
  encodeWebPushSubscription,
  normalizeWebPushSubscription,
  webPushDeviceKey,
} from '@/lib/web-push-subscription';

const DeleteSubscriptionSchema = z.object({ endpoint: z.string().min(1).max(4096) }).strict();

async function authenticatedUserId() {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.id) throw new AppError({ code: 'AUTHENTICATION_REQUIRED' });
  return session.user.id;
}

function validationError(field: string, message: string) {
  return new AppError({
    code: 'VALIDATION_FAILED',
    fields: [{ field, code: 'invalid_url', message }],
  });
}

async function postSubscription(req: NextRequest) {
  try {
    const userId = await authenticatedUserId();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AppError({ code: 'INVALID_JSON' });
    }

    const parsed = WebPushSubscriptionSchema.safeParse(body);
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

    let subscription;
    try {
      subscription = await normalizeWebPushSubscription(parsed.data);
    } catch {
      throw validationError(
        'endpoint',
        'A public HTTPS Web Push endpoint is required; private or reserved destinations are not allowed.'
      );
    }

    const deviceId = webPushDeviceKey(subscription.endpoint);
    const token = encodeWebPushSubscription(subscription);
    const userAgent = req.headers.get('user-agent')?.slice(0, 512) || undefined;

    await prisma.$transaction(async tx => {
      // Endpoint URLs are bearer-like capabilities. Persist only their hash as the
      // stable device key, and clean up previous plaintext-key rows opportunistically.
      await tx.userDevice.deleteMany({
        where: {
          userId: { not: userId },
          deviceId: { in: [deviceId, subscription.endpoint] },
        },
      });
      await tx.userDevice.deleteMany({ where: { userId, deviceId: subscription.endpoint } });

      await tx.userDevice.upsert({
        where: { userId_deviceId: { userId, deviceId } },
        update: { token, lastUsed: new Date(), userAgent, platform: 'web' },
        create: { userId, deviceId, token, platform: 'web', userAgent },
      });
      await tx.user.update({
        where: { id: userId },
        data: { pushNotificationsEnabled: true },
      });
    });

    return jsonOk({ success: true });
  } catch (error) {
    logger.error('push.subscription.save_failed', {
      component: 'push-subscription-api',
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'unknown',
    });
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR' }));
  }
}

async function deleteSubscription(req: NextRequest) {
  try {
    const userId = await authenticatedUserId();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AppError({ code: 'INVALID_JSON' });
    }
    const parsed = DeleteSubscriptionSchema.safeParse(body);
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

    let endpoint: string;
    try {
      endpoint = (await normalizeWebPushSubscription({
        endpoint: parsed.data.endpoint,
        expirationTime: null,
        keys: { p256dh: 'x'.repeat(16), auth: 'x'.repeat(8) },
      })).endpoint;
    } catch {
      throw validationError('endpoint', 'A valid public HTTPS Web Push endpoint is required.');
    }
    const deviceId = webPushDeviceKey(endpoint);

    const remainingDevices = await prisma.$transaction(async tx => {
      await tx.userDevice.deleteMany({
        where: { userId, deviceId: { in: [deviceId, endpoint] } },
      });
      const remaining = await tx.userDevice.count({ where: { userId, platform: 'web' } });
      if (remaining === 0) {
        await tx.user.update({
          where: { id: userId },
          data: { pushNotificationsEnabled: false },
        });
      }
      return remaining;
    });
    return jsonOk({ success: true, remainingDevices });
  } catch (error) {
    logger.error('push.subscription.delete_failed', {
      component: 'push-subscription-api',
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'unknown',
    });
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR' }));
  }
}

export const POST = withRequestContext(postSubscription, 'api.user.push-subscription.create');
export const DELETE = withRequestContext(deleteSubscription, 'api.user.push-subscription.delete');
