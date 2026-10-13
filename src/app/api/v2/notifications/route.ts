import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  buildCursorWhere,
  enforceV2Authorization,
  enforceV2RateLimit,
  formatCursorPagination,
  parsePaginationParams,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import type { NotificationChannel, NotificationStatus, Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.NOTIFICATION_READ);

    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);

    const channel = searchParams.get('channel')?.trim();
    const status = searchParams.get('status')?.trim();
    const incidentId = searchParams.get('incidentId')?.trim();
    const userId = searchParams.get('userId')?.trim();

    const filters: Prisma.NotificationWhereInput[] = [];

    // USER role can only see their own notifications
    if (actor.role === 'USER') {
      filters.push({ userId: actor.id });
    } else if (userId) {
      filters.push({ userId });
    }

    if (channel) filters.push({ channel: channel as NotificationChannel });
    if (status) filters.push({ status: status as NotificationStatus });
    if (incidentId) filters.push({ incidentId });

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.NotificationWhereInput);
    }

    const where: Prisma.NotificationWhereInput = filters.length > 0 ? { AND: filters } : {};

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        channel: true,
        status: true,
        recipientId: true,
        recipientDisplay: true,
        message: true,
        incidentId: true,
        userId: true,
        createdAt: true,
        incident: { select: { id: true, title: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const result = formatCursorPagination(notifications, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
