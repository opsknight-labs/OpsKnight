import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { NotificationPatchSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { AppError } from '@/lib/errors';

const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';

export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(await getAuthOptions());
        if (!session?.user?.email) {
            return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED', userMessage: LEGACY_UNAUTHORIZED_MESSAGE }));
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { id: true, timeZone: true }
        });

        if (!user) {
            return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: LEGACY_NOT_FOUND_MESSAGE }));
        }

        const userTimeZone = getUserTimeZone(user ?? undefined);

        const { searchParams } = new URL(req.url);
        const limit = parseLimit(searchParams.get('limit'));
        const unreadOnly = searchParams.get('unreadOnly') === 'true';

        const baseWhere = {
            userId: user.id
        };

        const where = unreadOnly
            ? { ...baseWhere, readAt: null }
            : baseWhere;

        const [notifications, unreadCount, total] = await Promise.all([
            prisma.inAppNotification.findMany({
                where,
                take: limit,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.inAppNotification.count({
                where: { ...baseWhere, readAt: null }
            }),
            prisma.inAppNotification.count({
                where: baseWhere
            })
        ]);

        const formattedNotifications = notifications.map((notification) => {
            const timeAgo = formatDateTime(notification.createdAt, userTimeZone, { format: 'relative' });
            const typeKey = notification.type.toLowerCase();
            const typeMap: Record<string, 'incident' | 'service' | 'schedule'> = {
                incident: 'incident',
                schedule: 'schedule',
                service: 'service',
                team: 'service'
            };
            const type = typeMap[typeKey] || 'incident';
            const incidentId = notification.entityType === 'INCIDENT'
                ? notification.entityId
                : null;

            return {
                id: notification.id,
                title: notification.title,
                message: notification.message,
                time: timeAgo,
                unread: !notification.readAt,
                type,
                incidentId,
                createdAt: notification.createdAt.toISOString()
            };
        });

        return jsonOk({ notifications: formattedNotifications, unreadCount, total }, 200);
    } catch (error) {
        logger.error('api.notifications.fetch_error', { error: error instanceof Error ? error.message : String(error) });
        return jsonError('Failed to fetch notifications', 500);
    }
}

function parseLimit(value: string | null) {
    const limit = Number(value);
    if (Number.isNaN(limit) || limit <= 0) return 50;
    return Math.min(limit, 200);
}

export async function PATCH(req: NextRequest) {
    try {
        const session = await getServerSession(await getAuthOptions());
        if (!session?.user?.email) {
            return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED', userMessage: LEGACY_UNAUTHORIZED_MESSAGE }));
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { id: true }
        });

        if (!user) {
            return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: LEGACY_NOT_FOUND_MESSAGE }));
        }

        let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
            body = await req.json();
        } catch (_error) {
            return jsonError(new AppError({ code: 'INVALID_JSON', userMessage: LEGACY_INVALID_INPUT_MESSAGE }));
        }
        const parsed = NotificationPatchSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError(
                new AppError({ code: 'VALIDATION_FAILED', userMessage: LEGACY_INVALID_INPUT_MESSAGE }),
                undefined,
                { issues: parsed.error.issues }
            );
        }
        const { notificationIds, markAllAsRead } = parsed.data;

        if (markAllAsRead) {
            await prisma.inAppNotification.updateMany({
                where: {
                    userId: user.id,
                    readAt: null
                },
                data: {
                    readAt: new Date()
                }
            });

            return jsonOk({ success: true, message: 'All notifications marked as read' }, 200);
        }

        if (notificationIds && Array.isArray(notificationIds)) {
            await prisma.inAppNotification.updateMany({
                where: {
                    id: { in: notificationIds },
                    userId: user.id
                },
                data: {
                    readAt: new Date()
                }
            });

            return jsonOk({ success: true, message: 'Notifications marked as read' }, 200);
        }

        return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: LEGACY_INVALID_INPUT_MESSAGE }));
    } catch (error) {
        logger.error('api.notifications.update_error', { error: error instanceof Error ? error.message : String(error) });
        return jsonError('Failed to update notifications', 500);
    }
}
