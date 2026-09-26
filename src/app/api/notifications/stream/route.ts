import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import { getNotificationUserChangeVersion } from '@/lib/notification-change-clock';
import { isAppError } from '@/lib/errors';
import { getRequestSessionJti } from '@/lib/realtime-stream-authorization';
import { isSessionActive } from '@/lib/session-registry';

/**
 * Server-Sent Events endpoint for real-time notification updates
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email && !session?.user?.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: session.user.id ? { id: session.user.id } : { email: session.user.email! },
      select: { id: true, timeZone: true, status: true, tokenVersion: true },
    });

    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (user.status === 'DISABLED') {
      return new Response('Forbidden', { status: 403 });
    }

    const sessionTokenVersion = session.user.tokenVersion ?? 0;
    const expectedTokenVersion = user.tokenVersion ?? 0;
    if (sessionTokenVersion !== expectedTokenVersion) {
      return new Response('Unauthorized', { status: 401 });
    }

    const sessionJti = await getRequestSessionJti(req);
    if (!sessionJti) {
      return new Response('Unauthorized', { status: 401 });
    }
    const active = await isSessionActive(user.id, sessionJti);
    if (!active) {
      return new Response('Unauthorized', { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    let initialAfterCreatedAt = searchParams.get('afterCreatedAt');
    let initialAfterId = searchParams.get('afterId') || '';

    const lastEventIdHeader = req.headers.get('last-event-id');
    if (!initialAfterCreatedAt && lastEventIdHeader) {
      const parts = lastEventIdHeader.split('_');
      if (parts.length >= 2) {
        initialAfterCreatedAt = parts[0];
        initialAfterId = parts.slice(1).join('_');
      } else {
        initialAfterId = lastEventIdHeader;
      }
    }

    let initialCursorDate: Date | null = null;
    if (initialAfterCreatedAt) {
      const d = new Date(initialAfterCreatedAt);
      if (!Number.isNaN(d.getTime())) {
        initialCursorDate = d;
      }
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
        const send = (data: string, eventId?: string) => {
          if (!isClosed) {
            try {
              const idPrefix = eventId ? `id: ${eventId}\n` : '';
              controller.enqueue(encoder.encode(`${idPrefix}data: ${data}\n\n`));
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

        // Provide immediate unread count upon handshake so UI badge is accurate without loading 50 records
        try {
          const initialUnreadCount = await prisma.inAppNotification.count({
            where: {
              userId: user.id,
              readAt: null,
            },
          });
          send(JSON.stringify({ type: 'unread_count', count: initialUnreadCount }));
        } catch (err) {
          logger.warn('Failed to fetch initial unread count for notification stream', {
            component: 'api-notifications-stream',
            error: err,
          });
        }

        // Initialize cursor for new/missed notifications
        let lastCheck = initialCursorDate ?? new Date();
        let lastCheckId = initialAfterId;

        // If client reconnected with a cursor, immediately backfill missed events
        if (initialCursorDate) {
          try {
            const missedNotifications = await prisma.inAppNotification.findMany({
              where: {
                userId: user.id,
                OR: [
                  { createdAt: { gt: lastCheck } },
                  { createdAt: lastCheck, id: { gt: lastCheckId || '' } },
                ],
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 50,
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

            if (missedNotifications.length > 0) {
              const formattedMissed = missedNotifications.map(notification => {
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

              const lastItem = missedNotifications[missedNotifications.length - 1];
              lastCheck = lastItem.createdAt;
              lastCheckId = lastItem.id;

              send(
                JSON.stringify({
                  type: 'notifications',
                  notifications: formattedMissed,
                  count: formattedMissed.length,
                }),
                `${lastItem.createdAt.toISOString()}_${lastItem.id}`
              );
            }
          } catch (err) {
            logger.warn('Failed to backfill missed notifications on stream reconnect', {
              component: 'api-notifications-stream',
              error: err,
            });
          }
        }

        let pollCount = 0;
        let notificationVersion = await getNotificationUserChangeVersion(user.id);

        pollInterval = setInterval(async () => {
          if (isClosed || isPolling) return;
          isPolling = true;
          pollCount++;
          try {
            const nextVersion = await getNotificationUserChangeVersion(user.id);
            const userChanged = nextVersion !== notificationVersion;
            notificationVersion = nextVersion;
            if (!userChanged && pollCount % 6 !== 0) {
              return;
            }
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

              const lastNotification = newNotifications[newNotifications.length - 1];
              lastCheck = lastNotification.createdAt;
              lastCheckId = lastNotification.id;
              shouldUpdateUnreadCount = true;

              send(
                JSON.stringify({
                  type: 'notifications',
                  notifications: formattedNotifications,
                  count: formattedNotifications.length,
                }),
                `${lastNotification.createdAt.toISOString()}_${lastNotification.id}`
              );
            }

            // Optimized Unread Count:
            // Only check unread count if:
            // 1. We found new notifications (count definitely changed)
            // 2. OR: Every 5th poll (every 25s) to catch up on "mark as read" from other tabs/devices
            if (shouldUpdateUnreadCount || pollCount % 6 === 0) {
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

            if (pollCount % 3 === 0) {
              try {
                const freshUser = await prisma.user.findUnique({
                  where: { id: user.id },
                  select: { status: true, tokenVersion: true },
                });
                if (
                  !freshUser ||
                  freshUser.status === 'DISABLED' ||
                  (freshUser.tokenVersion ?? 0) !== expectedTokenVersion
                ) {
                  send(JSON.stringify({ type: 'authorization_revoked' }));
                  cleanup();
                  return;
                }

                const active = await isSessionActive(user.id, sessionJti);
                if (!active) {
                  send(JSON.stringify({ type: 'authorization_revoked' }));
                  cleanup();
                  return;
                }
              } catch (authError) {
                logger.warn('notifications.authorization_recheck_failed', {
                  userId: user.id,
                  error: authError instanceof Error ? authError.message : String(authError),
                });
                // Fail closed: terminate stream on authorization recheck failure
                send(JSON.stringify({ type: 'authorization_revoked' }));
                cleanup();
                return;
              }
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
  } catch (error) {
    if (isAppError(error)) {
      if (error.code === 'AUTHENTICATION_REQUIRED' || error.code === 'SESSION_REVOKED') {
        return new Response(error.userMessage, { status: 401 });
      }
      if (error.code === 'USER_DISABLED') {
        return new Response(error.userMessage, { status: 403 });
      }
    }
    logger.error('Error in notification stream endpoint', {
      component: 'api-notifications-stream',
      error,
    });
    return new Response('Internal Server Error', { status: 500 });
  }
}
