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
 * GET /api/status-page/subscribers?page=1&limit=10&status=active|unsubscribed&verified=true&email=...
 */
export async function GET(req: NextRequest) {
  try {
    await assertAdmin();

    const searchParams = req.nextUrl.searchParams;
    const page = Number.parseInt(searchParams.get('page') || '1', 10);
    const limit = Number.parseInt(searchParams.get('limit') || '10', 10);
    const statusPageId = searchParams.get('statusPageId');
    const verifiedFilter = searchParams.get('verified');
    const statusFilter = searchParams.get('status'); // 'all', 'active', 'unsubscribed'
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

    if (!statusPageId) return jsonError('Status page ID is required', 400);
    where.statusPageId = statusPageId;

    if (statusFilter === 'active') {
      where.unsubscribedAt = null;
    } else if (statusFilter === 'unsubscribed') {
      where.unsubscribedAt = { not: null };
    }

    if (verifiedFilter === 'true') where.verified = true;
    else if (verifiedFilter === 'false') where.verified = false;

    if (searchEmail?.trim()) {
      where.email = { contains: searchEmail.trim(), mode: 'insensitive' };
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

    // Summary counts for quick status tab metrics
    const [totalActive, totalUnsubscribed, totalVerified] = await Promise.all([
      prisma.statusPageSubscription.count({ where: { statusPageId, unsubscribedAt: null } }),
      prisma.statusPageSubscription.count({
        where: { statusPageId, unsubscribedAt: { not: null } },
      }),
      prisma.statusPageSubscription.count({
        where: { statusPageId, verified: true, unsubscribedAt: null },
      }),
    ]);

    logger.info('api.status_page.subscribers.fetched', {
      page,
      limit,
      total,
      verified: verifiedFilter,
      status: statusFilter,
    });

    return jsonOk(
      {
        subscribers,
        total,
        page,
        limit,
        totalPages,
        metrics: {
          totalActive,
          totalUnsubscribed,
          totalVerified,
        },
      },
      200
    );
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('api.status_page.subscribers.error', { error });
    return jsonError('Failed to fetch subscribers', 500);
  }
}

/**
 * Delete/Unsubscribe a subscriber (single or bulk)
 * DELETE /api/status-page/subscribers?id=xxx&statusPageId=yyy
 * or DELETE body: { ids: string[], statusPageId: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin();

    let targetIds: string[] = [];
    let pageId: string | null = null;

    // Check if request has JSON body (bulk) or query parameters (single)
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const body = (await req.json()) as { id?: string; ids?: string[]; statusPageId?: string };
        pageId = body.statusPageId || null;
        if (Array.isArray(body.ids) && body.ids.length > 0) {
          targetIds = body.ids.filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0
          );
        } else if (typeof body.id === 'string' && body.id.trim()) {
          targetIds = [body.id.trim()];
        }
      } catch {
        // Fall back to query parameters
      }
    }

    if (targetIds.length === 0) {
      const idParam = req.nextUrl.searchParams.get('id');
      if (idParam) {
        targetIds = [idParam];
      }
    }

    if (!pageId) {
      pageId = req.nextUrl.searchParams.get('statusPageId');
    }

    if (targetIds.length === 0 || !pageId) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Subscription ID(s) and Status Page ID are required',
          fields: [
            ...(targetIds.length === 0
              ? [{ field: 'id', code: 'required', message: 'Subscription ID(s) required' }]
              : []),
            ...(!pageId
              ? [{ field: 'statusPageId', code: 'required', message: 'Status page ID required' }]
              : []),
          ],
        })
      );
    }

    const subscriptionId = targetIds[0];
    const statusPageId = pageId;

    if (targetIds.length === 1) {
      const subscription = await prisma.statusPageSubscription.findFirst({
        where: { id: subscriptionId, statusPageId },
      });
      if (!subscription) {
        return jsonError(new AppError(SUBSCRIPTION_NOT_FOUND));
      }
    }

    // Verify subscribers belong to this status page
    const existing = await prisma.statusPageSubscription.findMany({
      where: {
        id: { in: targetIds },
        statusPageId: pageId,
      },
      select: { id: true, email: true },
    });

    if (existing.length === 0) {
      return jsonError(new AppError(SUBSCRIPTION_NOT_FOUND));
    }

    const validIds = existing.map(sub => sub.id);

    await prisma.$transaction([
      prisma.statusPageSubscription.updateMany({
        where: { id: { in: validIds }, statusPageId: pageId },
        data: { unsubscribedAt: new Date(), state: 'UNSUBSCRIBED' },
      }),
      prisma.notification.updateMany({
        where: {
          recipientType: 'SUBSCRIBER',
          recipientId: { in: validIds },
          status: { in: ['PENDING', 'FAILED'] },
        },
        data: {
          status: 'SKIPPED',
          payloadEncrypted: null,
          errorMsg: 'Subscription was revoked before delivery.',
        },
      }),
    ]);

    logger.info('api.status_page.subscriber.bulk_unsubscribed', {
      count: validIds.length,
      statusPageId: pageId,
    });

    return jsonOk(
      {
        success: true,
        count: validIds.length,
        message:
          validIds.length === 1
            ? 'Subscriber unsubscribed successfully'
            : `${validIds.length} subscribers unsubscribed successfully`,
      },
      200
    );
  } catch (error) {
    const prismaError = prismaToAppError(error, { notFound: SUBSCRIPTION_NOT_FOUND });
    if (prismaError) return jsonError(prismaError);
    if (isAppError(error)) return jsonError(error);

    logger.error('api.status_page.subscriber.delete.error', { error });
    return jsonError('Failed to unsubscribe', 500);
  }
}
