/** Web Push delivery for OpsKnight incident notifications. */

import prisma from './prisma';
import { getPushConfig } from './notification-providers';
import { getBaseUrl } from './env-validation';
import { logger } from './logger';
import { getUserTimeZone } from './timezone';
import { formatPushTimestamp } from './mobile-time';
import { deliveryMarkerId, isDeliveryComplete, markDeliveryComplete } from './delivery-idempotency';
import {
  WebPushProviderError,
  decodeWebPushSubscription,
  sendWebPushSafely,
} from './web-push-subscription';

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
  data?: Record<string, unknown>;
  badge?: number;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function statusCode(error: unknown) {
  return error instanceof WebPushProviderError ? error.statusCode : undefined;
}

function isRestrictedDestinationError(error: unknown) {
  return /restricted network|HTTPS is required|credentials are not allowed/i.test(errorMessage(error));
}

export async function sendPush(options: PushOptions): Promise<PushResult> {
  try {
    const pushConfig = await getPushConfig();
    const devices = await prisma.userDevice.findMany({
      where: { userId: options.userId },
      orderBy: { lastUsed: 'desc' },
    });
    if (devices.length === 0) {
      return { success: false, code: 'NO_DEVICE_TOKENS', error: 'No device tokens found for user' };
    }
    if (!pushConfig.enabled) {
      logger.warn('Push notification skipped - provider not configured', {
        userId: options.userId,
        provider: pushConfig.provider,
      });
      return {
        success: false,
        code: 'PROVIDER_NOT_CONFIGURED',
        error: 'Push notifications are not enabled or configured',
      };
    }

    const vapidDetailsList: { subject: string; publicKey: string; privateKey: string }[] = [];
    if (
      pushConfig.provider === 'web-push' &&
      pushConfig.vapidPublicKey &&
      pushConfig.vapidPrivateKey
    ) {
      const publicKey = normalizeVapidKey(pushConfig.vapidPublicKey);
      const privateKey = normalizeVapidKey(pushConfig.vapidPrivateKey);
      if (publicKey && privateKey) {
        vapidDetailsList.push({
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
            vapidDetailsList.push({
              subject: pushConfig.vapidSubject || 'mailto:admin@localhost',
              publicKey: legacyPublic,
              privateKey: legacyPrivate,
            });
          }
        }
      }
    }
    if (
      vapidDetailsList.length === 0 &&
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY
    ) {
      const publicKey = normalizeVapidKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
      const privateKey = normalizeVapidKey(process.env.VAPID_PRIVATE_KEY);
      if (publicKey && privateKey) {
        vapidDetailsList.push({
          subject: process.env.VAPID_SUBJECT || 'mailto:admin@localhost',
          publicKey,
          privateKey,
        });
      }
    }

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
      return { success: false, code: 'VAPID_NOT_CONFIGURED', error: 'VAPID keys not configured' };
    }

    let successCount = 0;
    let checkpointedCount = 0;
    let terminalCount = 0;
    let retryableFailureCount = 0;
    let rateLimited = false;
    const errors: string[] = [];

    const removeDevice = async (deviceId: string) => {
      await prisma.userDevice.deleteMany({ where: { id: deviceId } });
      const remaining = await prisma.userDevice.count({
        where: { userId: options.userId, platform: 'web' },
      });
      if (remaining === 0) {
        await prisma.user.update({
          where: { id: options.userId },
          data: { pushNotificationsEnabled: false },
        });
      }
    };

    const sendToDevice = async (device: (typeof webDevices)[number]) => {
      const safeDeviceRef = device.id;
      const markerId = options.deliveryKey
        ? deliveryMarkerId('push-device', options.deliveryKey, device.id)
        : null;
      if (markerId && (await isDeliveryComplete(markerId))) {
        checkpointedCount += 1;
        return;
      }

      let subscription;
      try {
        subscription = await decodeWebPushSubscription(device.token);
      } catch {
        await removeDevice(device.id);
        terminalCount += 1;
        errors.push(`Device ${safeDeviceRef}: corrupted subscription removed`);
        return;
      }

      let parsedActions: unknown;
      const rawActions = options.data?.actions;
      if (Array.isArray(rawActions)) parsedActions = rawActions;
      else if (typeof rawActions === 'string') {
        try {
          parsedActions = JSON.parse(rawActions);
        } catch {
          parsedActions = undefined;
        }
      }
      const badge =
        typeof options.data?.badge === 'string'
          ? options.data.badge
          : '/icons/app-icon-192.png';
      const url = typeof options.data?.url === 'string' ? options.data.url : '/m';
      const urgency = options.data?.urgency === 'HIGH' ? 'HIGH' : 'NORMAL';
      const payload = JSON.stringify({
        title: options.title,
        body: options.body,
        data: options.data,
        icon: '/icons/app-icon-192.png',
        badge,
        url,
        actions: parsedActions,
      });

      let lastProviderError = 'delivery failed';
      for (const vapidDetails of vapidDetailsList) {
        try {
          await sendWebPushSafely(subscription, payload, {
            vapidDetails,
            TTL: urgency === 'HIGH' ? 3600 * 4 : 86400,
            urgency: urgency === 'HIGH' ? 'high' : 'normal',
            headers: { Urgency: urgency === 'HIGH' ? 'high' : 'normal' },
          });
          successCount += 1;
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
              deviceRecordId: safeDeviceRef,
              error: errorMessage(checkpointError),
            });
          }
          return;
        } catch (error) {
          const code = statusCode(error);
          lastProviderError = code ? `HTTP ${code}` : errorMessage(error);
          if (code === 429) rateLimited = true;

          const expired = code === 404 || code === 410;
          const restrictedDestination = isRestrictedDestinationError(error);
          if (expired || restrictedDestination) {
            await removeDevice(device.id);
            terminalCount += 1;
            errors.push(
              `Device ${safeDeviceRef}: ${
                restrictedDestination ? 'unsafe destination rejected' : 'subscription expired and removed'
              }`
            );
            return;
          }

          const tryHistoricalVapid =
            code === 401 ||
            code === 403 ||
            /vapid|authorization/i.test(errorMessage(error));
          if (!tryHistoricalVapid) {
            retryableFailureCount += 1;
            errors.push(
              `Device ${safeDeviceRef}: delivery failed${code ? ` (HTTP ${code})` : ''}`
            );
            return;
          }
        }
      }

      retryableFailureCount += 1;
      errors.push(`Device ${safeDeviceRef}: ${lastProviderError}`);
    };

    await Promise.allSettled(webDevices.map(sendToDevice));

    if (retryableFailureCount > 0) {
      return {
        success: false,
        code: 'DELIVERY_FAILED',
        error: errors.join('; ') || 'Failed to send to one or more devices',
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
      error: errors.join('; ') || 'No active web push subscriptions remain',
      deliveredCount: 0,
      checkpointedCount: 0,
      failedCount: 0,
    };
  } catch (error) {
    logger.error('push.send_failed', {
      component: 'push',
      userId: options.userId,
      error: errorMessage(error),
    });
    return { success: false, code: 'DELIVERY_FAILED', error: 'Push delivery failed' };
  }
}

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
        include: { service: true, assignee: true, team: true },
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
    let titleEmoji = '';
    let badge = '/icons/app-icon-192.png';
    if (eventType === 'triggered') {
      titleEmoji =
        incident.urgency === 'HIGH' ? '🔴' : incident.urgency === 'MEDIUM' ? '🟡' : '🔵';
      badge =
        incident.urgency === 'HIGH' ? '/icons/badge-critical.png' : '/icons/badge-info.png';
    } else if (eventType === 'acknowledged') titleEmoji = '✅';
    else titleEmoji = '✓';

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
        ? `${titleEmoji} ${
            incident.urgency === 'HIGH' ? 'CRITICAL' : 'Incident'
          } • ${incident.service?.name}`
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
    let body = `${incident.title}\n${eventLabel} • ${ownerLabel} • ${timeLabel}`;
    if (incident.urgency === 'HIGH') body += '\n🚨 Urgent Action Required';
    if (incident.description) {
      body += `\n${
        incident.description.length > 60
          ? `${incident.description.substring(0, 60)}...`
          : incident.description
      }`;
    }
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
  } catch (error) {
    logger.error('push.incident_send_failed', {
      component: 'push',
      incidentId,
      userId,
      eventType,
      error: errorMessage(error),
    });
    return { success: false, code: 'DELIVERY_FAILED', error: 'Incident push delivery failed' };
  }
}
