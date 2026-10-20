import 'server-only';

import prisma from '@/lib/prisma';
import crypto from 'crypto';
import { decryptProviderConfig } from '@/lib/encrypted-provider-config';
import {
  createCentralNotificationIntent,
  enqueueCentralNotification,
  type CentralNotificationInput,
} from '@/lib/notification-control-plane';
import { logAudit } from '@/lib/audit';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { escapeHtml } from '@/lib/email-components';

export type ProviderTestStatus =
  'ACCEPTED' | 'DELIVERED' | 'QUEUED' | 'DEFERRED' | 'CONFIGURED_NO_DEVICE' | 'FAILED' | 'UNKNOWN';

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

export type ProviderTestIntent = {
  input: CentralNotificationInput;
  channel: string;
  provider: string;
  revision: number;
};

export async function prepareProviderTestIntent(
  providerKey: string,
  user: ProviderTestUser,
  eventKey: string,
  configOverride?: Record<string, unknown>
): Promise<ProviderTestIntent> {
  const normalizedKey = providerKey.toLowerCase();
  const lookupKey = normalizedKey === 'whatsapp' ? 'twilio' : normalizedKey;
  const record = await prisma.notificationProvider.findUnique({ where: { provider: lookupKey } });
  if (!record || (normalizedKey !== 'whatsapp' && !record.enabled)) {
    throw new AppError({ code: 'NOTIFICATION_PROVIDER_UNAVAILABLE' });
  }
  const config =
    configOverride ??
    (await decryptProviderConfig(lookupKey, (record.config as Record<string, unknown>) || {}));
  if (normalizedKey !== 'whatsapp') {
    const { assertProviderConfigReady, notificationProviderKeySchema } =
      await import('@/lib/notifications/provider-schema');
    const provider = notificationProviderKeySchema.parse(lookupKey);
    assertProviderConfigReady(provider, config);
  }
  const now = new Date().toISOString();
  let input: CentralNotificationInput;
  if (['resend', 'sendgrid', 'ses', 'smtp'].includes(normalizedKey)) {
    if (!user.email)
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage:
          'The active administrator must have an email address to receive a provider test.',
      });
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
        html: `<p>OpsKnight provider test via ${normalizedKey.toUpperCase()} at ${now}.</p>`,
        text: `[OpsKnight] Provider test notification via ${normalizedKey.toUpperCase()} at ${now}.`,
        providerKey: normalizedKey,
      },
    };
  } else if (
    normalizedKey === 'twilio' ||
    normalizedKey === 'aws-sns' ||
    normalizedKey === 'whatsapp'
  ) {
    const whatsapp = normalizedKey === 'whatsapp';
    const target = user.phoneNumber;
    if (!target)
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage:
          'The active administrator must have a phone number to receive this provider test.',
      });
    if (whatsapp && !config.whatsappEnabled && !config.whatsappNumber)
      throw new AppError({ code: 'NOTIFICATION_PROVIDER_UNAVAILABLE' });
    const channel = whatsapp ? 'WHATSAPP' : 'SMS';
    input = {
      category: 'SYSTEM',
      channel,
      recipientType: 'USER',
      recipientId: user.id,
      recipientAddress: String(target),
      userId: user.id,
      templateKey: 'provider-test',
      sourceType: 'USER',
      sourceId: user.id,
      eventKey,
      displayMessage: `Provider test via ${whatsapp ? 'WhatsApp' : normalizedKey.toUpperCase()}`,
      priority: 2,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      payload: {
        kind: whatsapp ? 'WHATSAPP' : 'SMS',
        to: String(target),
        message: `[OpsKnight] Provider test via ${normalizedKey.toUpperCase()} at ${now}.`,
        providerKey: whatsapp ? 'twilio' : normalizedKey,
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
      displayMessage: 'Provider test via Web Push',
      priority: 2,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      payload: {
        kind: 'PUSH',
        userId: user.id,
        title: 'OpsKnight Provider Test',
        body: 'Web Push is configured and active.',
        data: { url: '/settings/notifications', type: 'test' },
        providerKey: 'web-push',
      },
    };
  } else {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Unsupported notification provider.',
    });
  }
  return {
    input,
    channel: input.channel,
    provider: normalizedKey === 'whatsapp' ? 'twilio' : normalizedKey,
    revision: record.revision,
  };
}

export async function queueProviderTestIntent(options: {
  providerKey: string;
  user: ProviderTestUser;
  eventKey: string;
  client: Prisma.TransactionClient;
  apiKeyId: string;
  expectedRevision: number;
}) {
  const activeAdmin = await options.client.user.findFirst({
    where: { id: options.user.id, role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  if (!activeAdmin) {
    const { AppError } = await import('@/lib/errors');
    throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  }
  const prepared = await prepareProviderTestIntent(
    options.providerKey,
    options.user,
    options.eventKey
  );
  const lookupKey = options.providerKey === 'whatsapp' ? 'twilio' : options.providerKey;
  const current = await options.client.notificationProvider.findUnique({
    where: { provider: lookupKey },
    select: { revision: true, enabled: true },
  });
  if (
    !current ||
    current.revision !== options.expectedRevision ||
    current.revision !== prepared.revision ||
    (!current.enabled && options.providerKey !== 'whatsapp')
  ) {
    const { preconditionFailed } = await import('@/lib/api-v2/concurrency');
    throw preconditionFailed();
  }
  const created = await createCentralNotificationIntent(prepared.input, options.client);
  await logAudit(
    {
      action: 'notification_provider.test_queued',
      entityType: 'SYSTEM_CONFIG',
      entityId: created.id,
      actorId: options.user.id,
      details: {
        provider: prepared.provider,
        channel: prepared.channel,
        created: created.created,
        apiKeyId: options.apiKeyId,
      },
    },
    options.client
  );
  return {
    id: created.id,
    provider: prepared.provider,
    channel: prepared.channel,
    status: created.skipped ? 'SKIPPED' : 'PENDING',
    created: created.created,
  };
}

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
            <p style="font-size: 12px; color: #6b7280;">Dispatched by: ${escapeHtml(user.name || user.email || 'Admin')} (${escapeHtml(user.role || 'ADMIN')})</p>
            <p style="font-size: 12px; color: #6b7280;">Timestamp: ${new Date().toISOString()}</p>
          </div>
        `,
        text: `[OpsKnight Test] Provider Test Successful. Outbound alert dispatched via ${normalizedKey.toUpperCase()}.`,
        providerKey: normalizedKey,
      },
    };
  } else if (normalizedKey === 'twilio') {
    const targetPhone = user.phoneNumber;
    if (!targetPhone) {
      return {
        success: false,
        status: 'FAILED',
        provider: 'twilio',
        channel: 'SMS',
        message:
          'No recipient phone number available. Add a phone number to your profile.',
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

    const targetPhone = user.phoneNumber;
    if (!targetPhone) {
      return {
        success: false,
        status: 'FAILED',
        provider: 'twilio',
        channel: 'WHATSAPP',
        message: 'Add a phone number to your profile to receive a WhatsApp provider test.',
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
