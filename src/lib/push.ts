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
import { deliveryMarkerId, isDeliveryComplete, markDeliveryComplete } from './delivery-idempotency';

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
  /** Stable logical intent used to checkpoint delivery independently per device. */
  deliveryKey?: string;
};

export type PushFailureCode =
  | 'NO_DEVICE_TOKENS'
  | 'NO_WEB_SUBSCRIPTIONS'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'VAPID_NOT_CONFIGURED'
  | 'RECIPIENT_NOT_FOUND'
  | 'DELIVERY_FAILED';

export type PushResult = {
  success: boolean;
  error?: string;
  code?: PushFailureCode;
  deliveredCount?: number;
  checkpointedCount?: number;
  failedCount?: number;
  statusCode?: number;
  retryAfterMs?: number;
};

/**
 * Send push notification
 * Uses logger output for development mode
 */
export async function sendPush(options: PushOptions): Promise<PushResult> {
  try {
    // Get push configuration
    const pushConfig = await getPushConfig();

    // Get user's device tokens
    const devices = await prisma.userDevice.findMany({
      where: { userId: options.userId },
      orderBy: { lastUsed: 'desc' },
    });

    if (devices.length === 0) {
      return {
        success: false,
        code: 'NO_DEVICE_TOKENS',
        error: 'No device tokens found for user',
      };
    }

    // If provider is not enabled, log and return failure
    if (!pushConfig.enabled) {
      logger.warn('Push notification skipped - provider not configured', {
        userId: options.userId,
        title: options.title,
        body: options.body,
        provider: pushConfig.provider,
      });

      return {
        success: false,
        code: 'PROVIDER_NOT_CONFIGURED',
        error: 'Push notifications are not enabled or configured',
      };
    }

    // Production: Use configured provider
    let successCount = 0;
    let checkpointedCount = 0;
    let terminalCount = 0;
    let retryableFailureCount = 0;
    let rateLimited = false;
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
      const markerId = options.deliveryKey
        ? deliveryMarkerId('push-device', options.deliveryKey, device.id)
        : null;
      if (markerId && (await isDeliveryComplete(markerId))) {
        checkpointedCount++;
        return;
      }

      if (vapidDetailsList.length === 0) {
        errorMessages.push(`Device ${device.deviceId}: VAPID keys not configured`);
        retryableFailureCount++;
        return;
      }

      let subscription: any;
      try {
        subscription = JSON.parse(device.token);
        if (!subscription?.endpoint) {
          throw new Error('Malformed subscription object');
        }
      } catch {
        await prisma.userDevice.deleteMany({ where: { id: device.id } });
        const remaining = await prisma.userDevice.count({
          where: { userId: options.userId },
        });
        if (remaining === 0) {
          await prisma.user.update({
            where: { id: options.userId },
            data: { pushNotificationsEnabled: false },
          });
        }
        errorMessages.push(`Device ${device.deviceId}: Corrupted token purged`);
        terminalCount++;
        return;
      }

      try {
        let parsedActions: unknown = undefined;
        if (options.data?.actions) {
          if (Array.isArray(options.data.actions)) {
            parsedActions = options.data.actions;
          } else if (typeof options.data.actions === 'string') {
            try {
              parsedActions = JSON.parse(options.data.actions);
            } catch {
              parsedActions = undefined;
            }
          }
        }

        const payload = JSON.stringify({
          title: options.title,
          body: options.body,
          data: options.data,
          icon: '/icons/app-icon-192.png',
          badge: options.data?.badge || '/icons/app-icon-192.png',
          url: options.data?.url || '/m',
          actions: parsedActions,
        });
        let sent = false;
        let lastErrorMessage = 'Unknown error';

        const isHighUrgency = options.data?.urgency === 'HIGH';
        for (const vapidDetails of vapidDetailsList) {
          try {
            await webpush.sendNotification(subscription, payload, {
              vapidDetails,
              TTL: isHighUrgency ? 3600 * 4 : 86400,
              urgency: isHighUrgency ? 'high' : 'normal',
              headers: {
                Urgency: isHighUrgency ? 'high' : 'normal',
              },
            });
            successCount++;
            sent = true;
            // Provider acceptance is already irreversible. Persistence errors
            // must not cause another VAPID-key attempt and duplicate the push.
            try {
              await prisma.userDevice.update({
                where: { id: device.id },
                data: { lastUsed: new Date() },
              });
              if (markerId && options.deliveryKey) {
                await markDeliveryComplete({
                  markerId,
                  namespace: 'push-device',
                  deliveryKey: options.deliveryKey,
                  targetId: device.id,
                });
              }
            } catch (checkpointError) {
              logger.error('push.device_checkpoint_failed_after_acceptance', {
                userId: options.userId,
                deviceId: device.deviceId,
                error:
                  checkpointError instanceof Error
                    ? checkpointError.message
                    : String(checkpointError),
              });
            }
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
            if (statusCode === 429) rateLimited = true;

            const isExpiredOrRevoked =
              statusCode === 410 ||
              statusCode === 404 ||
              (statusCode === 400 &&
                /baddevicetoken|notregistered|invalidregistration|unregistered|devicetokennotfortopic/i.test(
                  errorMessage
                ));

            if (isExpiredOrRevoked) {
              await prisma.userDevice.deleteMany({ where: { id: device.id } });
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
              terminalCount++;
              return;
            }

            const shouldRetry =
              statusCode === 401 ||
              statusCode === 403 ||
              errorMessage.toLowerCase().includes('vapid') ||
              errorMessage.toLowerCase().includes('authorization');

            if (!shouldRetry) {
              errorMessages.push(`Device ${device.deviceId}: ${errorMessage}`);
              retryableFailureCount++;
              return;
            }
          }
        }

        if (!sent) {
          errorMessages.push(`Device ${device.deviceId}: ${lastErrorMessage}`);
          retryableFailureCount++;
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
        if (statusCode === 429) rateLimited = true;

        const isExpiredOrRevoked =
          statusCode === 410 ||
          statusCode === 404 ||
          (statusCode === 400 &&
            /baddevicetoken|notregistered|invalidregistration|unregistered|devicetokennotfortopic/i.test(
              errorMessage
            ));

        if (isExpiredOrRevoked) {
          await prisma.userDevice.deleteMany({ where: { id: device.id } });
          const remaining = await prisma.userDevice.count({ where: { userId: options.userId } });
          if (remaining === 0) {
            await prisma.user.update({
              where: { id: options.userId },
              data: { pushNotificationsEnabled: false },
            });
          }
          errorMessages.push(`Device ${device.deviceId}: Subscription expired (removed)`);
          terminalCount++;
        } else {
          errorMessages.push(`Device ${device.deviceId}: ${errorMessage}`);
          retryableFailureCount++;
        }
      }
    };

    if (pushConfig.provider !== 'web-push') {
      return {
        success: false,
        code: 'PROVIDER_NOT_CONFIGURED',
        error: 'No push notification provider configured',
      };
    }

    const webDevices = devices.filter(device => device.platform === 'web');
    if (webDevices.length === 0) {
      return {
        success: false,
        code: 'NO_WEB_SUBSCRIPTIONS',
        error: 'No web push subscriptions found for user',
      };
    }

    if (vapidDetailsList.length === 0) {
      return {
        success: false,
        code: 'VAPID_NOT_CONFIGURED',
        error: 'VAPID keys not configured',
      };
    }

    await Promise.allSettled(webDevices.map(device => sendWebPush(device)));

    if (retryableFailureCount > 0) {
      return {
        success: false,
        code: 'DELIVERY_FAILED',
        error: errorMessages.join('; ') || 'Failed to send to one or more devices',
        deliveredCount: successCount,
        checkpointedCount,
        failedCount: retryableFailureCount,
        statusCode: rateLimited ? 429 : undefined,
        retryAfterMs: rateLimited ? 60_000 : undefined,
      };
    }
    if (successCount + checkpointedCount > 0) {
      return {
        success: true,
        deliveredCount: successCount,
        checkpointedCount,
        failedCount: 0,
      };
    }
    return {
      success: false,
      code: terminalCount > 0 ? 'NO_WEB_SUBSCRIPTIONS' : 'DELIVERY_FAILED',
      error: errorMessages.join('; ') || 'No active web push subscriptions remain',
      deliveredCount: 0,
      checkpointedCount: 0,
      failedCount: 0,
    };
  } catch (error: any) {
    logger.error('Push send error', { component: 'push', error, userId: options.userId });
    return { success: false, code: 'DELIVERY_FAILED', error: error.message };
  }
}

/**
 * Send incident notification push
 */
export async function sendIncidentPush(
  userId: string,
  incidentId: string,
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated'
): Promise<PushResult> {
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
      return {
        success: false,
        code: 'RECIPIENT_NOT_FOUND',
        error: 'User or incident not found',
      };
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
          : eventType === 'resolved'
            ? 'Resolved'
            : 'Updated';

    const title =
      eventType === 'triggered'
        ? `${titleEmoji} ${incident.urgency === 'HIGH' ? 'CRITICAL' : 'Incident'} • ${incident.service?.name}`
        : `${titleEmoji} ${eventLabel} • ${incident.service?.name}`;

    const eventTime =
      eventType === 'acknowledged'
        ? incident.acknowledgedAt || incident.updatedAt || incident.createdAt
        : eventType === 'resolved'
          ? incident.resolvedAt || incident.updatedAt || incident.createdAt
          : incident.updatedAt || incident.createdAt;

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
        badge,
        tag: `incident-${incidentId}`,
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
    return { success: false, code: 'DELIVERY_FAILED', error: error.message };
  }
}
