import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger, withRequestContext } from '@/lib/logger';
import { AppError, isAppError } from '@/lib/errors';
import { jsonError, jsonOk } from '@/lib/api-response';

const PushSubscriptionSchema = z
  .object({
    endpoint: z.string().min(1).max(4096),
    expirationTime: z.number().finite().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(16).max(1024),
        auth: z.string().min(8).max(1024),
      })
      .strict(),
  })
  .strict();

const DeleteSubscriptionSchema = z.object({ endpoint: z.string().min(1).max(4096) }).strict();

function validateEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function authenticatedUserId() {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.id) {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED' });
  }
  return session.user.id;
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

    const parsed = PushSubscriptionSchema.safeParse(body);
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

    const endpoint = validateEndpoint(parsed.data.endpoint);
    if (!endpoint) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'endpoint', code: 'invalid_url', message: 'HTTPS push endpoint required.' }],
      });
    }

    const normalizedSubscription = {
      endpoint,
      expirationTime: parsed.data.expirationTime ?? null,
      keys: parsed.data.keys,
    };
    const token = JSON.stringify(normalizedSubscription);
    const userAgent = req.headers.get('user-agent')?.slice(0, 512) || undefined;

    await prisma.$transaction(async tx => {
      // A browser endpoint belongs to one account at a time. This prevents a
      // shared browser profile from continuing to receive the previous user's alerts.
      await tx.userDevice.deleteMany({
        where: { deviceId: endpoint, userId: { not: userId } },
      });

      await tx.userDevice.upsert({
        where: { userId_deviceId: { userId, deviceId: endpoint } },
        update: { token, lastUsed: new Date(), userAgent },
        create: {
          userId,
          deviceId: endpoint,
          token,
          platform: 'web',
          userAgent,
        },
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
      error,
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
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
    const endpoint = validateEndpoint(parsed.data.endpoint);
    if (!endpoint) {
      throw new AppError({ code: 'VALIDATION_FAILED' });
    }

    const remainingDevices = await prisma.$transaction(async tx => {
      await tx.userDevice.deleteMany({ where: { userId, deviceId: endpoint } });
      const remaining = await tx.userDevice.count({ where: { userId } });
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
      error,
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    });
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR' }));
  }
}

export const POST = withRequestContext(postSubscription, 'api.user.push-subscription.create');
export const DELETE = withRequestContext(deleteSubscription, 'api.user.push-subscription.delete');
