/**
 * Push Notification Service
 * Sends push notifications for incidents
 *
 * Push notification providers are configured via the UI at Settings -> System -> Notification Providers
 */

import prisma from './prisma';
import { getPushConfig } from './notification-providers';
import { getBaseUrl } from './env-validation';
import { logger } from './logger';
import { getUserTimeZone } from './timezone';
import { formatPushTimestamp } from './mobile-time';
import webpush from 'web-push';

// Configure Web Push if keys are present
// We will configure VAPID details per-request based on DB config or Env variables

function normalizeVapidKey(rawKey?: string | null) {
  if (!rawKey) return undefined;
  const trimmed = rawKey.trim();
  if (!trimmed) return undefined;
  const cleaned = trimmed.replace(/^['"]|['"]$/g, '').replace(/\s+/g, '');
  return cleaned.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export type PushOptions = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  badge?: number;
};

/**
 * Send push notification
 * Uses logger output for development mode
 */
export async function sendPush(
  options: PushOptions
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get push configuration
    const pushConfig = await getPushConfig();

    // Get user's device tokens
    const devices = await prisma.userDevice.findMany({
      where: { userId: options.userId },
      orderBy: { lastUsed: 'desc' },
    });

    if (devices.length === 0) {
      return { success: false, error: 'No device tokens found for user' };
    }

    // If provider is not enabled, log and return (mock mode)
    // Note: In development, we still want to send if enabled to test functionality
    if (!pushConfig.enabled) {
      logger.info('Push notification (mock)', {
        userId: options.userId,
        title: options.title,
        body: options.body,
        provider: pushConfig.provider,
      });

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 100));

      return { success: true };
    }

    // Production: Use configured provider
    let successCount = 0;
    const errorMessages: string[] = [];
    const resolveVapidDetailsList = () => {
      const details: { subject: string; publicKey: string; privateKey: string }[] = [];

      if (
        pushConfig.provider === 'web-push' &&
        pushConfig.vapidPublicKey &&
        pushConfig.vapidPrivateKey
      ) {
        const publicKey = normalizeVapidKey(pushConfig.vapidPublicKey);
        const privateKey = normalizeVapidKey(pushConfig.vapidPrivateKey);
        if (publicKey && privateKey) {
          details.push({
            subject: pushConfig.vapidSubject || 'mailto:admin@localhost',
            publicKey,
            privateKey,
          });
        }

        if (Array.isArray(pushConfig.vapidKeyHistory)) {
          for (const entry of pushConfig.vapidKeyHistory) {
            const legacyPublic = normalizeVapidKey(entry.publicKey);
            const legacyPrivate = normalizeVapidKey(entry.privateKey);
            if (legacyPublic && legacyPrivate) {
              details.push({
                subject: pushConfig.vapidSubject || 'mailto:admin@localhost',
                publicKey: legacyPublic,
                privateKey: legacyPrivate,
              });
            }
          }
        }
      }

      if (details.length > 0) {
        return details;
      }

      if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        const publicKey = normalizeVapidKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
        const privateKey = normalizeVapidKey(process.env.VAPID_PRIVATE_KEY);
        if (!publicKey || !privateKey) {
          return [];
        }
        return [
          {
            subject: process.env.VAPID_SUBJECT || 'mailto:admin@localhost',
            publicKey,
            privateKey,
          },
        ];
      }

      return [];
    };

    const vapidDetailsList = resolveVapidDetailsList();

    const sendWebPush = async (device: (typeof devices)[number]) => {
      if (vapidDetailsList.length === 0) {
        errorMessages.push(`Device ${device.deviceId}: VAPID keys not configured`);
        return;
      }

      let subscription: any;
      try {
        subscription = JSON.parse(device.token);
        if (!subscription?.endpoint) {
          throw new Error('Malformed subscription object');
        }
      } catch {
        await prisma.userDevice.delete({ where: { id: device.id } });
        errorMessages.push(`Device ${device.deviceId}: Corrupted token purged`);
        return;
      }

      try {
        const payload = JSON.stringify({
          title: options.title,
          body: options.body,
          data: options.data,
          icon: '/icons/app-icon-192.png',
          badge: options.data?.badge || '/icons/app-icon-192.png',
          url: options.data?.url || '/m',
          actions: options.data?.actions ? JSON.parse(options.data.actions) : undefined,
        });
        let sent = false;
        let lastErrorMessage = 'Unknown error';

        for (const vapidDetails of vapidDetailsList) {
          try {
            await webpush.sendNotification(subscription, payload, { vapidDetails });
            await prisma.userDevice.update({
              where: { id: device.id },
              data: { lastUsed: new Date() },
            });
            successCount++;
            sent = true;
            break;
          } catch (error: unknown) {
            const statusCode =
              typeof error === 'object' && error !== null && 'statusCode' in error
                ? (error as { statusCode?: number }).statusCode
                : undefined;
            const errorMessage =
              typeof error === 'object' && error !== null && 'message' in error
                ? String((error as { message?: unknown }).message ?? '')
                : 'Unknown error';
            lastErrorMessage = errorMessage;

            if (statusCode === 410 || statusCode === 404) {
              await prisma.userDevice.delete({ where: { id: device.id } });
              const remaining = await prisma.userDevice.count({
                where: { userId: options.userId },
              });
              if (remaining === 0) {
                await prisma.user.update({
                  where: { id: options.userId },
                  data: { pushNotificationsEnabled: false },
                });
              }
              errorMessages.push(`Device ${device.deviceId}: Subscription expired (removed)`);
              return;
            }

            const shouldRetry =
              statusCode === 401 ||
              statusCode === 403 ||
              errorMessage.toLowerCase().includes('vapid') ||
              errorMessage.toLowerCase().includes('authorization');

            if (!shouldRetry) {
              errorMessages.push(`Device ${device.deviceId}: ${errorMessage}`);
              return;
            }
          }
        }

        if (!sent) {
          errorMessages.push(`Device ${device.deviceId}: ${lastErrorMessage}`);
        }
      } catch (error: unknown) {
        const statusCode =
          typeof error === 'object' && error !== null && 'statusCode' in error
            ? (error as { statusCode?: number }).statusCode
            : undefined;
        const errorMessage =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message ?? '')
            : 'Unknown error';

        if (statusCode === 410 || statusCode === 404) {
          await prisma.userDevice.delete({ where: { id: device.id } });
          const remaining = await prisma.userDevice.count({ where: { userId: options.userId } });
          if (remaining === 0) {
            await prisma.user.update({
              where: { id: options.userId },
              data: { pushNotificationsEnabled: false },
            });
          }
          errorMessages.push(`Device ${device.deviceId}: Subscription expired (removed)`);
        } else {
          errorMessages.push(`Device ${device.deviceId}: ${errorMessage}`);
        }
      }
    };

    if (pushConfig.provider !== 'web-push') {
      return { success: false, error: 'No push notification provider configured' };
    }

    const webDevices = devices.filter(device => device.platform === 'web');
    if (webDevices.length === 0) {
      return { success: false, error: 'No web push subscriptions found for user' };
    }

    if (vapidDetailsList.length === 0) {
      return { success: false, error: 'VAPID keys not configured' };
    }

    for (const device of webDevices) {
      await sendWebPush(device);
    }

    if (successCount > 0) {
      return { success: true };
    } else {
      return { success: false, error: errorMessages.join('; ') || 'Failed to send to all devices' };
    }
  } catch (error: any) {
    logger.error('Push send error', { component: 'push', error, userId: options.userId });
    return { success: false, error: error.message };
  }
}

/**
 * Send incident notification push
 */
export async function sendIncidentPush(
  userId: string,
  incidentId: string,
  eventType: 'triggered' | 'acknowledged' | 'resolved'
): Promise<{ success: boolean; error?: string }> {
  try {
    const [user, incident] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.incident.findUnique({
        where: { id: incidentId },
        include: {
          service: true,
          assignee: true,
          team: true,
        },
      }),
    ]);

    if (!user || !incident) {
      return { success: false, error: 'User or incident not found' };
    }

    const baseUrl = getBaseUrl();
    const incidentUrl = `${baseUrl}/incidents/${incidentId}`;

    const userTimeZone = getUserTimeZone(user ?? undefined);

    // Enhanced emoji logic based on urgency and event
    let titleEmoji = '';
    let badge = '/icons/app-icon-192.png';

    if (eventType === 'triggered') {
      titleEmoji = incident.urgency === 'HIGH' ? '🔴' : incident.urgency === 'MEDIUM' ? '🟡' : '🔵';
      badge = incident.urgency === 'HIGH' ? '/icons/badge-critical.png' : '/icons/badge-info.png';
    } else if (eventType === 'acknowledged') {
      titleEmoji = '✅';
    } else {
      titleEmoji = '✓';
    }

    const urgencyLabel =
      incident.urgency === 'HIGH' ? 'CRITICAL' : incident.urgency === 'MEDIUM' ? 'MEDIUM' : 'LOW';

    const eventLabel =
      eventType === 'triggered'
        ? 'Triggered'
        : eventType === 'acknowledged'
          ? 'Acknowledged'
          : 'Resolved';

    const title =
      eventType === 'triggered'
        ? `${titleEmoji} ${incident.urgency === 'HIGH' ? 'CRITICAL' : 'Incident'} • ${incident.service?.name}`
        : `${titleEmoji} ${eventLabel} • ${incident.service?.name}`;

    const eventTime =
      eventType === 'acknowledged'
        ? incident.acknowledgedAt || incident.updatedAt || incident.createdAt
        : eventType === 'resolved'
          ? incident.resolvedAt || incident.updatedAt || incident.createdAt
          : incident.createdAt;

    const timeLabel = formatPushTimestamp(eventTime, userTimeZone);
    const ownerLabel =
      incident.assignee?.name || incident.assignee?.email || incident.team?.name || 'Unassigned';

    // Premium Concise Body:
    // "Title of the incident..."
    // "Status • Owner • Time"

    let body = `${incident.title}`;
    body += `\n${eventLabel} • ${ownerLabel} • ${timeLabel}`;

    if (incident.urgency === 'HIGH') {
      body += `\n🚨 Urgent Action Required`;
    }

    if (incident.description) {
      const shortDesc =
        incident.description.length > 60
          ? incident.description.substring(0, 60) + '...'
          : incident.description;
      body += `\n${shortDesc}`;
    }

    // Action buttons for triggered incidents
    const actions =
      eventType === 'triggered'
        ? [
            { action: 'view', title: '👁️ View', icon: '/icons/app-icon-192.png' },
            {
              action: 'acknowledge',
              title: '✓ Acknowledge',
              icon: '/icons/app-icon-192.png',
            },
          ]
        : [{ action: 'view', title: '👁️ View', icon: '/icons/app-icon-192.png' }];

    return await sendPush({
      userId,
      title,
      body,
      data: {
        incidentId,
        incidentUrl,
        eventType,
        urgency: incident.urgency,
        status: incident.status,
        url: `/m/incidents/${incidentId}`,
        actions: JSON.stringify(actions),
      },
      badge: 1,
    });
  } catch (error: any) {
    logger.error('Send incident push error', {
      component: 'push',
      error,
      incidentId,
      userId,
      eventType,
    });
    return { success: false, error: error.message };
  }
}
