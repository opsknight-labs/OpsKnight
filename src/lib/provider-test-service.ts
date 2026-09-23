import 'server-only';

import prisma from '@/lib/prisma';
import crypto from 'crypto';
import { decryptProviderConfig } from '@/lib/encrypted-provider-config';
import {
  enqueueCentralNotification,
  type CentralNotificationInput,
} from '@/lib/notification-control-plane';
import { logAudit } from '@/lib/audit';

export type ProviderTestStatus =
  | 'ACCEPTED'
  | 'DELIVERED'
  | 'QUEUED'
  | 'DEFERRED'
  | 'CONFIGURED_NO_DEVICE'
  | 'FAILED'
  | 'UNKNOWN';

export type ProviderTestResult = {
  success: boolean;
  status: ProviderTestStatus;
  provider: string;
  channel: string;
  notificationId?: string;
  providerMessageId?: string;
  errorCode?: string;
  retryAt?: string;
  message: string;
};

export type ProviderTestUser = {
  id: string;
  email?: string | null;
  phoneNumber?: string | null;
  name?: string | null;
  role?: string;
};

/**
 * Resolves the final state of a test notification intent from the database.
 */
export async function resolveTestNotificationOutcome(
  notificationId: string,
  providerKey: string,
  channel: string
): Promise<ProviderTestResult> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      status: true,
      providerMessageId: true,
      nextAttemptAt: true,
      errorMsg: true,
      deliveryAttempts: {
        orderBy: { ordinal: 'desc' },
        take: 1,
        select: {
          outcome: true,
          provider: true,
          providerMessageId: true,
          errorCode: true,
          errorMessage: true,
        },
      },
    },
  });

  const latestAttempt = notification?.deliveryAttempts?.[0];
  const providerMessageId =
    notification?.providerMessageId || latestAttempt?.providerMessageId || undefined;
  const errorCode = latestAttempt?.errorCode || undefined;
  const errorMessage = latestAttempt?.errorMessage || notification?.errorMsg || undefined;

  if (
    channel === 'PUSH' &&
    /no (?:device tokens|web subscription|recipient device)/i.test(errorMessage || '')
  ) {
    return {
      success: true,
      status: 'CONFIGURED_NO_DEVICE',
      provider: latestAttempt?.provider || providerKey,
      channel,
      notificationId,
      errorCode,
      message: 'Web Push is configured, but this account has no registered browser subscription.',
    };
  }

  if (notification?.status === 'DELIVERED') {
    return {
      success: true,
      status: 'DELIVERED',
      provider: latestAttempt?.provider || providerKey,
      channel,
      notificationId,
      providerMessageId,
      message: `Test notification delivered successfully via ${providerKey.toUpperCase()}`,
    };
  }

  if (notification?.status === 'SENT') {
    return {
      success: true,
      status: 'ACCEPTED',
      provider: latestAttempt?.provider || providerKey,
      channel,
      notificationId,
      providerMessageId,
      message: `Test notification accepted by provider ${providerKey.toUpperCase()}`,
    };
  }

  if (notification?.status === 'UNKNOWN') {
    return {
      success: false,
      status: 'UNKNOWN',
      provider: latestAttempt?.provider || providerKey,
      channel,
      notificationId,
      providerMessageId,
      errorCode,
      message: errorMessage
        ? `Delivery unconfirmed (ambiguous provider outcome): ${errorMessage}`
        : 'Notification submitted to provider but delivery status is unconfirmed (awaiting reconciliation).',
    };
  }

  if (
    notification?.status === 'PENDING' &&
    (latestAttempt?.outcome === 'RATE_LIMITED' ||
      latestAttempt?.outcome === 'DEFERRED_NOT_DUE' ||
      (notification.nextAttemptAt && notification.nextAttemptAt.getTime() > Date.now()))
  ) {
    const formattedDate = notification.nextAttemptAt?.toISOString();
    return {
      success: false,
      status: 'DEFERRED',
      provider: latestAttempt?.provider || providerKey,
      channel,
      notificationId,
      errorCode,
      retryAt: formattedDate,
      message: errorMessage
        ? `Delivery deferred until ${formattedDate}: ${errorMessage}`
        : `Delivery deferred due to provider rate limit or capacity constraints until ${formattedDate}.`,
    };
  }

  if (
    notification?.status === 'PENDING' &&
    (!latestAttempt || latestAttempt.outcome === 'ACCEPTED')
  ) {
    return {
      success: false,
      status: 'QUEUED',
      provider: providerKey,
      channel,
      notificationId,
      message: 'Test notification enqueued in the notification control plane; not yet delivered.',
    };
  }

  // FAILED or SKIPPED
  return {
    success: false,
    status: 'FAILED',
    provider: latestAttempt?.provider || providerKey,
    channel,
    notificationId,
    errorCode,
    message: errorMessage || `Test notification failed to deliver via ${providerKey.toUpperCase()}`,
  };
}

/**
 * Executes a state-aware test notification for any configured notification provider.
 * Shared between Server Actions and API route entry points.
 */
export async function executeProviderTest(
  providerKey: string,
  user: ProviderTestUser
): Promise<ProviderTestResult> {
  const normalizedKey = providerKey.toLowerCase();
  const lookupKey = normalizedKey === 'whatsapp' ? 'twilio' : normalizedKey;

  const providerRecord = await prisma.notificationProvider.findUnique({
    where: { provider: lookupKey },
  });

  if (!providerRecord) {
    return {
      success: false,
      status: 'FAILED',
      provider: providerKey,
      channel: 'UNKNOWN',
      message: `Provider '${providerKey}' is not configured.`,
    };
  }

  // For Twilio, WhatsApp can be active even if Twilio SMS is disabled
  if (normalizedKey !== 'whatsapp' && !providerRecord.enabled) {
    return {
      success: false,
      status: 'FAILED',
      provider: providerKey,
      channel: 'UNKNOWN',
      message: `Provider '${providerKey}' is disabled.`,
    };
  }

  const decryptedConfig = await decryptProviderConfig(
    lookupKey,
    (providerRecord.config as Record<string, unknown>) || {}
  );

  const eventKey = `test-provider:${normalizedKey}:${crypto.randomUUID()}`;

  let input: CentralNotificationInput;

  if (['resend', 'sendgrid', 'ses', 'smtp'].includes(normalizedKey)) {
    if (!user.email) {
      return {
        success: false,
        status: 'FAILED',
        provider: normalizedKey,
        channel: 'EMAIL',
        message: 'Current user has no email address configured to receive the test message.',
      };
    }

    input = {
      category: 'SYSTEM',
      channel: 'EMAIL',
      recipientType: 'USER',
      recipientId: user.id,
      recipientAddress: user.email,
      userId: user.id,
      templateKey: 'provider-test',
      sourceType: 'USER',
      sourceId: user.id,
      eventKey,
      displayMessage: `Provider test via ${normalizedKey.toUpperCase()}`,
      priority: 2,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      payload: {
        kind: 'EMAIL',
        to: user.email,
        subject: `[OpsKnight Test] Outbound Alert via ${normalizedKey.toUpperCase()}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #111;">
            <h2 style="color: #059669; margin-bottom: 8px;">✅ Provider Test Successful</h2>
            <p>This is an automated test notification dispatched from your OpsKnight instance via <strong>${normalizedKey.toUpperCase()}</strong>.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
            <p style="font-size: 12px; color: #6b7280;">Dispatched by: ${user.name || user.email || 'Admin'} (${user.role || 'ADMIN'})</p>
            <p style="font-size: 12px; color: #6b7280;">Timestamp: ${new Date().toISOString()}</p>
          </div>
        `,
        text: `[OpsKnight Test] Provider Test Successful. Outbound alert dispatched via ${normalizedKey.toUpperCase()}.`,
        providerKey: normalizedKey,
      },
    };
  } else if (normalizedKey === 'twilio') {
    const targetPhone =
      user.phoneNumber ||
      (decryptedConfig?.fromNumber as string) ||
      (decryptedConfig?.phoneNumber as string);
    if (!targetPhone) {
      return {
        success: false,
        status: 'FAILED',
        provider: 'twilio',
        channel: 'SMS',
        message:
          'No recipient phone number available. Add a phone number to your profile or configure a test number.',
      };
    }

    input = {
      category: 'SYSTEM',
      channel: 'SMS',
      recipientType: 'USER',
      recipientId: user.id,
      recipientAddress: targetPhone,
      userId: user.id,
      templateKey: 'provider-test',
      sourceType: 'USER',
      sourceId: user.id,
      eventKey,
      displayMessage: `Provider test via Twilio SMS`,
      priority: 2,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      payload: {
        kind: 'SMS',
        to: targetPhone,
        message: `[OpsKnight] Provider test successful! Twilio SMS is operational. Dispatched: ${new Date().toLocaleTimeString()}`,
        providerKey: 'twilio',
      },
    };
  } else if (normalizedKey === 'aws-sns') {
    const targetPhone = user.phoneNumber;
    if (!targetPhone) {
      return {
        success: false,
        status: 'FAILED',
        provider: 'aws-sns',
        channel: 'SMS',
        message:
          'No recipient phone number available. Add a phone number to your profile to test AWS SNS SMS.',
      };
    }

    input = {
      category: 'SYSTEM',
      channel: 'SMS',
      recipientType: 'USER',
      recipientId: user.id,
      recipientAddress: targetPhone,
      userId: user.id,
      templateKey: 'provider-test',
      sourceType: 'USER',
      sourceId: user.id,
      eventKey,
      displayMessage: `Provider test via AWS SNS SMS`,
      priority: 2,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      payload: {
        kind: 'SMS',
        to: targetPhone,
        message: `[OpsKnight] Provider test successful! AWS SNS SMS is operational. Dispatched: ${new Date().toLocaleTimeString()}`,
        providerKey: 'aws-sns',
      },
    };
  } else if (normalizedKey === 'whatsapp') {
    const whatsappEnabled =
      decryptedConfig?.whatsappEnabled !== undefined
        ? Boolean(decryptedConfig.whatsappEnabled)
        : Boolean(decryptedConfig?.whatsappNumber);
    if (!whatsappEnabled) {
      return {
        success: false,
        status: 'FAILED',
        provider: 'twilio',
        channel: 'WHATSAPP',
        message: 'WhatsApp messaging is not enabled in the Twilio configuration.',
      };
    }

    const targetPhone = user.phoneNumber || (decryptedConfig?.whatsappNumber as string);
    if (!targetPhone) {
      return {
        success: false,
        status: 'FAILED',
        provider: 'twilio',
        channel: 'WHATSAPP',
        message: 'No WhatsApp phone number configured.',
      };
    }

    input = {
      category: 'SYSTEM',
      channel: 'WHATSAPP',
      recipientType: 'USER',
      recipientId: user.id,
      recipientAddress: targetPhone,
      userId: user.id,
      templateKey: 'provider-test',
      sourceType: 'USER',
      sourceId: user.id,
      eventKey,
      displayMessage: `Provider test via WhatsApp`,
      priority: 2,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      payload: {
        kind: 'WHATSAPP',
        to: targetPhone,
        message: `[OpsKnight] WhatsApp provider test successful! Dispatched: ${new Date().toLocaleTimeString()}`,
        providerKey: 'twilio',
      },
    };
  } else if (normalizedKey === 'web-push') {
    input = {
      category: 'SYSTEM',
      channel: 'PUSH',
      recipientType: 'USER',
      recipientId: user.id,
      recipientAddress: user.id,
      userId: user.id,
      templateKey: 'provider-test',
      sourceType: 'USER',
      sourceId: user.id,
      eventKey,
      displayMessage: `Provider test via Web Push`,
      priority: 2,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      payload: {
        kind: 'PUSH',
        userId: user.id,
        title: '🔔 OpsKnight Provider Test',
        body: 'Web Push (VAPID) provider is active and verified.',
        data: { url: '/settings/notifications', type: 'test' },
        providerKey: 'web-push',
      },
    };
  } else {
    return {
      success: false,
      status: 'FAILED',
      provider: providerKey,
      channel: 'UNKNOWN',
      message: `Unsupported notification provider: '${providerKey}'.`,
    };
  }

  try {
    const enqueueResult = await enqueueCentralNotification(input, { dispatchImmediately: true });

    if (enqueueResult.skipped) {
      if (
        input.channel === 'PUSH' &&
        /no (?:device tokens|web subscription|recipient device)/i.test(enqueueResult.error || '')
      ) {
        return {
          success: true,
          status: 'CONFIGURED_NO_DEVICE',
          provider: normalizedKey,
          channel: input.channel,
          notificationId: enqueueResult.id,
          message:
            'Web Push is configured, but this account has no registered browser subscription.',
        };
      }
      return {
        success: false,
        status: 'FAILED',
        provider: normalizedKey === 'whatsapp' ? 'twilio' : normalizedKey,
        channel: input.channel,
        notificationId: enqueueResult.id,
        message:
          enqueueResult.error || 'Recipient endpoint is unavailable or notification was skipped.',
      };
    }

    const outcome = await resolveTestNotificationOutcome(
      enqueueResult.id,
      normalizedKey === 'whatsapp' ? 'twilio' : normalizedKey,
      input.channel
    );

    if (outcome.success) {
      await logAudit({
        action: 'notification_provider.tested',
        entityType: 'USER',
        entityId: user.id,
        actorId: user.id,
        details: {
          provider: outcome.provider,
          channel: outcome.channel,
          status: outcome.status,
          notificationId: outcome.notificationId,
        },
      });
    }

    return outcome;
  } catch (error) {
    return {
      success: false,
      status: 'FAILED',
      provider: normalizedKey === 'whatsapp' ? 'twilio' : normalizedKey,
      channel: input.channel,
      message: error instanceof Error ? error.message : 'Failed to dispatch test notification',
    };
  }
}
