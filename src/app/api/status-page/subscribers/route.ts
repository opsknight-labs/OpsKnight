import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { prismaToAppError } from '@/lib/prisma-errors';
import { logger } from '@/lib/logger';
import { assertAdmin } from '@/lib/rbac';

const SUBSCRIPTION_NOT_FOUND = {
  code: 'RESOURCE_NOT_FOUND' as const,
  userMessage: 'Subscription not found',
};

/**
 * Get Status Page Subscribers
 * GET /api/status-page/subscribers?page=1&limit=10&verified=true
 */
export async function GET(req: NextRequest) {
  try {
    await assertAdmin();

    const searchParams = req.nextUrl.searchParams;
    const page = Number.parseInt(searchParams.get('page') || '1', 10);
    const limit = Number.parseInt(searchParams.get('limit') || '10', 10);
    const statusPageId = searchParams.get('statusPageId');
    const verifiedFilter = searchParams.get('verified');
    const searchEmail = searchParams.get('email');

    if (!Number.isFinite(page) || page < 1 || !Number.isFinite(limit) || limit < 1 || limit > 100) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Invalid pagination parameters.',
          fields: [
            ...(page < 1 || !Number.isFinite(page)
              ? [{ field: 'page', code: 'invalid', message: 'page must be a positive integer' }]
              : []),
            ...(limit < 1 || limit > 100 || !Number.isFinite(limit)
              ? [
                  {
                    field: 'limit',
                    code: 'invalid',
                    message: 'limit must be between 1 and 100',
                  },
                ]
              : []),
          ],
        })
      );
    }

    const skip = (page - 1) * limit;
    const where: Prisma.StatusPageSubscriptionWhereInput = {};

    if (statusPageId) where.statusPageId = statusPageId;
    if (verifiedFilter === 'true') where.verified = true;
    else if (verifiedFilter === 'false') where.verified = false;
    if (searchEmail) {
      where.email = { contains: searchEmail, mode: 'insensitive' };
    }

    const total = await prisma.statusPageSubscription.count({ where });
    const subscribers = await prisma.statusPageSubscription.findMany({
      where,
      include: {
        statusPage: {
          select: { id: true, name: true },
        },
      },
      orderBy: { subscribedAt: 'desc' },
      skip,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    logger.info('api.status_page.subscribers.fetched', {
      page,
      limit,
      total,
      verified: verifiedFilter,
    });

    return jsonOk({ subscribers, total, page, limit, totalPages }, 200);
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('api.status_page.subscribers.error', { error });
    return jsonError('Failed to fetch subscribers', 500);
  }
}

/**
 * Delete/Unsubscribe a subscriber
 * DELETE /api/status-page/subscribers?id=xxx
 */
export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin();

    const subscriptionId = req.nextUrl.searchParams.get('id');
    if (!subscriptionId) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Subscription ID is required',
          fields: [
            { field: 'id', code: 'required', message: 'Subscription ID is required' },
          ],
        })
      );
    }

    const subscription = await prisma.statusPageSubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!subscription) {
      return jsonError(new AppError(SUBSCRIPTION_NOT_FOUND));
    }

    await prisma.statusPageSubscription.update({
      where: { id: subscriptionId },
      data: { unsubscribedAt: new Date() },
    });

    logger.info('api.status_page.subscriber.unsubscribed', {
      subscriptionId,
      email: subscription.email,
    });

    return jsonOk({ success: true, message: 'Subscriber unsubscribed successfully' }, 200);
  } catch (error) {
    const prismaError = prismaToAppError(error, { notFound: SUBSCRIPTION_NOT_FOUND });
    if (prismaError) return jsonError(prismaError);
    if (isAppError(error)) return jsonError(error);

    logger.error('api.status_page.subscriber.delete.error', { error });
    return jsonError('Failed to unsubscribe', 500);
  }
}
