import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';

const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) {
      return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED', userMessage: LEGACY_UNAUTHORIZED_MESSAGE }));
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, timeZone: true },
    });

    if (!user) {
      return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: LEGACY_NOT_FOUND_MESSAGE }));
    }

    const userTimeZone = getUserTimeZone(user ?? undefined);

    const { searchParams } = new URL(req.url);
    const limitRaw = Number(searchParams.get('limit') || '50');
    const offsetRaw = Number(searchParams.get('offset') || '0');
    const limit = Number.isNaN(limitRaw) ? 50 : Math.min(limitRaw, 200);
    const offset = Number.isNaN(offsetRaw) ? 0 : Math.max(offsetRaw, 0);
    const channel = searchParams.get('channel');
    const status = searchParams.get('status');
    const query = searchParams.get('q')?.trim();
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    const allowedChannels = new Set(['EMAIL', 'SMS', 'PUSH', 'SLACK', 'WEBHOOK', 'WHATSAPP']);
    const allowedStatuses = new Set(['PENDING', 'SENT', 'FAILED']);

    const baseWhere: any = {
      userId: user.id,
    };

    if (channel && channel !== 'all' && allowedChannels.has(channel)) {
      baseWhere.channel = channel;
    }

    const listWhere = { ...baseWhere };
    if (status && status !== 'all' && allowedStatuses.has(status)) {
      listWhere.status = status;
    }

    if (query) {
      const searchFilter = [
        { message: { contains: query, mode: 'insensitive' } },
        { incident: { title: { contains: query, mode: 'insensitive' } } },
      ];
      baseWhere.OR = searchFilter;
      listWhere.OR = searchFilter;
    }

    const parseDate = (value: string | null) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed;
    };

    const fromDate = parseDate(fromParam);
    const toDate = parseDate(toParam);
    if (fromDate || toDate) {
      const range: { gte?: Date; lte?: Date } = {};
      if (fromDate) range.gte = fromDate;
      if (toDate) range.lte = toDate;
      baseWhere.createdAt = range;
      listWhere.createdAt = range;
    }

    const [notifications, total, grouped] = await Promise.all([
      prisma.notification.findMany({
        where: listWhere,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          incident: {
            select: {
              id: true,
              title: true,
              status: true,
              urgency: true,
            },
          },
        },
      }),
      prisma.notification.count({ where: listWhere }),
      prisma.notification.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    const stats = {
      total: 0,
      sent: 0,
      pending: 0,
      failed: 0,
    };
    for (const entry of grouped) {
      const count = entry._count._all;
      stats.total += count;
      if (entry.status === 'SENT') {
        stats.sent += count;
      } else if (entry.status === 'PENDING') {
        stats.pending += count;
      } else if (entry.status === 'FAILED') {
        stats.failed += count;
      }
    }

    const formattedNotifications = notifications.map(notification => {
      const createdAtMs = notification.createdAt.getTime();
      const deliveredMs = notification.deliveredAt?.getTime();
      const sentMs = notification.sentAt?.getTime();
      const failedMs = notification.failedAt?.getTime();
      const endMs = deliveredMs ?? sentMs ?? failedMs ?? null;
      const latencyMs = endMs !== null ? Math.max(0, endMs - createdAtMs) : null;
      const pendingForMs =
        notification.status === 'PENDING' ? Math.max(0, Date.now() - createdAtMs) : null;

      return {
        id: notification.id,
        channel: notification.channel,
        status: notification.status,
        message: notification.message,
        attempts: notification.attempts,
        incident: notification.incident
          ? {
              id: notification.incident.id,
              title: notification.incident.title,
              status: notification.incident.status,
              urgency: notification.incident.urgency,
            }
          : null,
        sentAt: notification.sentAt
          ? formatDateTime(notification.sentAt, userTimeZone, { format: 'datetime' })
          : null,
        deliveredAt: notification.deliveredAt
          ? formatDateTime(notification.deliveredAt, userTimeZone, { format: 'datetime' })
          : null,
        failedAt: notification.failedAt
          ? formatDateTime(notification.failedAt, userTimeZone, { format: 'datetime' })
          : null,
        errorMsg: notification.errorMsg,
        createdAt: formatDateTime(notification.createdAt, userTimeZone, { format: 'datetime' }),
        latencyMs,
        pendingForMs,
      };
    });

    return jsonOk(
      {
        notifications: formattedNotifications,
        total,
        limit,
        offset,
        stats,
      },
      200,
      {
        'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
      }
    );
  } catch (error) {
    logger.error('api.notifications.history.fetch_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch notification history', 500);
  }
}
