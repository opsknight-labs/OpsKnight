import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { logger } from '@/lib/logger';

/**
 * Server-Sent Events endpoint for real-time notification updates
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, timeZone: true, status: true },
  });

  if (!user) {
    return new Response('User not found', { status: 404 });
  }

  if (user.status === 'DISABLED') {
    return new Response('Forbidden', { status: 403 });
  }

  const userTimeZone = getUserTimeZone(user ?? undefined);

  let cleanup: () => void = () => {};

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let isClosed = false;

      let pollInterval: NodeJS.Timeout | null = null;
      let isPolling = false;

      cleanup = () => {
        isClosed = true;
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        try {
          controller.close();
        } catch (_error) {
          // Controller already closed, ignore
        }
      };

      // Send initial connection message
      const send = (data: string) => {
        if (!isClosed) {
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch (error) {
            logger.error('Error sending SSE data', {
              component: 'api-notifications-stream',
              error,
            });
            cleanup();
          }
        }
      };

      send(JSON.stringify({ type: 'connected', message: 'Notification stream connected' }));

      // Poll for new notifications every 5 seconds (reduced from 2s to save DB)
      let lastCheck = new Date();
      let lastCheckId = '';
      let pollCount = 0;

      pollInterval = setInterval(async () => {
        if (isClosed || isPolling) return;
        isPolling = true;
        pollCount++;
        try {
          // Optimized query: purely time-based, uses index [userId, createdAt]
          // We check for ANY new notification regardless of read status to notify the user
          const newNotifications = await prisma.inAppNotification.findMany({
            where: {
              userId: user.id,
              OR: [
                { createdAt: { gt: lastCheck } },
                { createdAt: lastCheck, id: { gt: lastCheckId || '' } },
              ],
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 8,
            select: {
              id: true,
              title: true,
              message: true,
              type: true,
              entityType: true,
              entityId: true,
              readAt: true,
              createdAt: true,
            },
          });

          let shouldUpdateUnreadCount = false;

          if (newNotifications.length > 0) {
            const formattedNotifications = newNotifications.map(notification => {
              const timeAgo = formatDateTime(notification.createdAt, userTimeZone, {
                format: 'relative',
              });
              const typeKey = notification.type.toLowerCase();
              let type: 'incident' | 'service' | 'schedule' = 'incident';
              if (typeKey === 'schedule') {
                type = 'schedule';
              } else if (typeKey === 'service' || typeKey === 'team') {
                type = 'service';
              }
              const incidentId =
                notification.entityType === 'INCIDENT' ? notification.entityId : null;

              return {
                id: notification.id,
                title: notification.title,
                message: notification.message,
                time: timeAgo,
                unread: !notification.readAt,
                type,
                incidentId,
                createdAt: notification.createdAt.toISOString(),
              };
            });

            send(
              JSON.stringify({
                type: 'notifications',
                notifications: formattedNotifications,
                count: formattedNotifications.length,
              })
            );

            // Update last check time
            const lastNotification = newNotifications[newNotifications.length - 1];
            lastCheck = lastNotification.createdAt;
            lastCheckId = lastNotification.id;
            shouldUpdateUnreadCount = true;
          }

          // Optimized Unread Count:
          // Only check unread count if:
          // 1. We found new notifications (count definitely changed)
          // 2. OR: Every 5th poll (every 25s) to catch up on "mark as read" from other tabs/devices
          if (shouldUpdateUnreadCount || pollCount % 5 === 0) {
            const unreadCount = await prisma.inAppNotification.count({
              where: {
                userId: user.id,
                readAt: null,
              },
            });

            send(
              JSON.stringify({
                type: 'unread_count',
                count: unreadCount,
              })
            );
          }

          send(JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }));
        } catch (error) {
          logger.error('Error polling notifications', {
            component: 'api-notifications-stream',
            error,
          });
          send(
            JSON.stringify({
              type: 'error',
              message: 'Error fetching notifications',
            })
          );
        } finally {
          isPolling = false;
        }
      }, 5000);

      // Cleanup on client disconnect
      req.signal.addEventListener('abort', () => {
        cleanup();
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
