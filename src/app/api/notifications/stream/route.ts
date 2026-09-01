import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import { getCurrentUser } from '@/lib/rbac';
import { resolveStreamAuthorization } from '@/lib/realtime-stream-authorization';

/**
 * Server-Sent Events endpoint for real-time notification updates.
 * The stream periodically revalidates account status and tokenVersion so a
 * deactivation/session revocation takes effect without waiting for disconnect.
 */
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const expectedTokenVersion = user.tokenVersion ?? 0;
  const userTimeZone = getUserTimeZone(user);

  let cleanup: () => void = () => {};

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
          // Controller already closed.
        }
      };

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

      let lastCheck = new Date();
      let lastCheckId = '';
      let pollCount = 0;

      pollInterval = setInterval(async () => {
        if (isClosed || isPolling) return;
        isPolling = true;
        pollCount++;
        try {
          if (pollCount % 12 === 0) {
            const authorization = await resolveStreamAuthorization(user.id, expectedTokenVersion);
            if (!authorization) {
              send(JSON.stringify({ type: 'authorization_revoked' }));
              cleanup();
              return;
            }
          }

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

            const lastNotification = newNotifications[newNotifications.length - 1];
            lastCheck = lastNotification.createdAt;
            lastCheckId = lastNotification.id;
            shouldUpdateUnreadCount = true;
          }

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
