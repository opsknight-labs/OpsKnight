'use server';

import prisma from '@/lib/prisma';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { Prisma } from '@prisma/client';
import {
  decryptProviderConfig,
  encryptProviderConfig,
  maskSensitiveFields,
  mergeSensitiveProviderFields,
} from '@/lib/encrypted-provider-config';

/**
 * Get all notification provider configurations
 */
export async function getNotificationProviders() {
  await assertAdmin();

  const providers = await prisma.notificationProvider.findMany({
    orderBy: { provider: 'asc' },
  });

  return providers.map(p => ({
    id: p.id,
    provider: p.provider,
    enabled: p.enabled,
    config: maskSensitiveFields(p.provider, (p.config as Record<string, unknown>) || {}),
    updatedAt: p.updatedAt.toISOString(),
  }));
}

/**
 * Update notification provider configuration
 */
export async function updateNotificationProvider(
  providerId: string | null,
  provider: string,
  enabled: boolean,
  config: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
) {
  try {
    await assertAdmin();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Unauthorized. Admin access required.'
    );
  }

  const user = await getCurrentUser();

  const existingProvider = providerId
    ? await prisma.notificationProvider.findUnique({ where: { id: providerId } })
    : await prisma.notificationProvider.findUnique({ where: { provider } });
  const existingConfig = existingProvider?.config
    ? await decryptProviderConfig(provider, existingProvider.config as Record<string, unknown>)
    : {};
  const mergedConfig = mergeSensitiveProviderFields(provider, config, existingConfig);
  const encryptedConfig = await encryptProviderConfig(provider, mergedConfig);

  if (providerId) {
    // Update existing
    await prisma.notificationProvider.update({
      where: { id: providerId },
      data: {
        enabled,
        config: encryptedConfig as Prisma.InputJsonValue,
        updatedBy: user.id,
      },
    });
  } else {
    // Create new
    await prisma.notificationProvider.upsert({
      where: { provider },
      create: {
        provider,
        enabled,
        config: encryptedConfig as Prisma.InputJsonValue,
        updatedBy: user.id,
      },
      update: {
        enabled,
        config: encryptedConfig as Prisma.InputJsonValue,
        updatedBy: user.id,
      },
    });
  }

  await logAudit({
    action: 'notification_provider.updated',
    entityType: 'USER',
    entityId: user.id,
    actorId: user.id,
    details: { provider, enabled },
  });

  revalidatePath('/settings/system');
  return { success: true };
}

/**
 * Generate and persist VAPID keys for Web Push
 */
export async function generateVapidKeys(options?: {
  subject?: string;
  rotate?: boolean;
  keepPrevious?: boolean;
}) {
  try {
    await assertAdmin();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Unauthorized. Admin access required.'
    );
  }

  const { generateVAPIDKeys } = await import('web-push');
  const { publicKey, privateKey } = generateVAPIDKeys();
  const subject = options?.subject?.trim() || 'mailto:admin@example.com';

  const user = await getCurrentUser();
  const existing = await prisma.notificationProvider.findUnique({
    where: { provider: 'web-push' },
  });
  const existingConfig = existing?.config
    ? await decryptProviderConfig('web-push', existing.config as Record<string, unknown>)
    : {};
  const previousKeys = Array.isArray(existingConfig.vapidKeyHistory)
    ? (existingConfig.vapidKeyHistory as Array<{ publicKey: string; privateKey: string }>)
    : [];

  const shouldRotate = !!options?.rotate;
  const keepPrevious = options?.keepPrevious !== false;
  const nextHistory =
    shouldRotate && keepPrevious && existingConfig.vapidPublicKey
      ? [
          {
            publicKey: String(existingConfig.vapidPublicKey),
            privateKey: String(existingConfig.vapidPrivateKey || ''),
          },
          ...previousKeys,
        ]
      : previousKeys;

  const nextConfig = {
    ...existingConfig,
    vapidPublicKey: publicKey,
    vapidPrivateKey: privateKey,
    vapidSubject: subject,
    vapidKeyHistory: nextHistory
      .filter(entry => entry.publicKey && entry.privateKey)
      .filter(
        (entry, index, all) => all.findIndex(item => item.publicKey === entry.publicKey) === index
      )
      .slice(0, 3),
  };

  const encryptedNextConfig = await encryptProviderConfig('web-push', nextConfig);
  await prisma.notificationProvider.upsert({
    where: { provider: 'web-push' },
    create: {
      provider: 'web-push',
      enabled: existing?.enabled ?? false,
      config: encryptedNextConfig as Prisma.InputJsonValue,
      updatedBy: user.id,
    },
    update: {
      config: encryptedNextConfig as Prisma.InputJsonValue,
      updatedBy: user.id,
    },
  });

  await logAudit({
    action: 'vapid_keys.rotated',
    entityType: 'USER',
    entityId: user.id,
    actorId: user.id,
    details: { subject, rotated: shouldRotate },
  });

  revalidatePath('/settings/notifications');
  revalidatePath('/settings/system');

  return { publicKey, privateKey, subject };
}

/**
 * Test a notification provider configuration by sending a test alert
 */
export async function testNotificationProvider(
  providerKey: string
): Promise<{ success: boolean; message: string }> {
  try {
    await assertAdmin();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Unauthorized. Admin access required.'
    );
  }

  const user = await getCurrentUser();
  const normalizedKey = providerKey.toLowerCase();
  const lookupKey = normalizedKey === 'whatsapp' ? 'twilio' : normalizedKey;

  const providerRecord = await prisma.notificationProvider.findUnique({
    where: { provider: lookupKey },
  });

  if (!providerRecord || !providerRecord.enabled) {
    throw new Error(`Provider '${providerKey}' is not configured or enabled.`);
  }

  const decryptedConfig = await decryptProviderConfig(
    lookupKey,
    (providerRecord.config as Record<string, unknown>) || {}
  );

  const { enqueueCentralNotification } = await import('@/lib/notification-control-plane');
  const crypto = await import('crypto');
  const eventKey = `test-provider:${normalizedKey}:${crypto.randomUUID()}`;

  if (['resend', 'sendgrid', 'ses', 'smtp'].includes(normalizedKey)) {
    if (!user.email) {
      throw new Error('Current user has no email address configured to receive the test message.');
    }

    const result = await enqueueCentralNotification({
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
            <p style="font-size: 12px; color: #6b7280;">Dispatched by: ${user.name || user.email} (${user.role})</p>
            <p style="font-size: 12px; color: #6b7280;">Timestamp: ${new Date().toISOString()}</p>
          </div>
        `,
        text: `[OpsKnight Test] Provider Test Successful. Outbound alert dispatched via ${normalizedKey.toUpperCase()}.`,
        providerKey: normalizedKey,
      },
    });

    if (!result.delivered && result.error) {
      throw new Error(result.error);
    }
  } else if (normalizedKey === 'twilio') {
    const targetPhone =
      user.phoneNumber ||
      (decryptedConfig?.fromNumber as string) ||
      (decryptedConfig?.phoneNumber as string);
    if (!targetPhone) {
      throw new Error(
        'No recipient phone number available. Add a phone number to your profile or configure a test number.'
      );
    }

    const result = await enqueueCentralNotification({
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
    });

    if (!result.delivered && result.error) {
      throw new Error(result.error);
    }
  } else if (normalizedKey === 'whatsapp') {
    const whatsappEnabled = Boolean(decryptedConfig?.whatsappEnabled);
    if (!whatsappEnabled) {
      throw new Error('WhatsApp messaging is not enabled in the Twilio configuration.');
    }

    const targetPhone = user.phoneNumber || (decryptedConfig?.whatsappNumber as string);
    if (!targetPhone) {
      throw new Error('No WhatsApp phone number configured.');
    }

    const result = await enqueueCentralNotification({
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
        providerKey: 'whatsapp',
      },
    });

    if (!result.delivered && result.error) {
      throw new Error(result.error);
    }
  } else if (normalizedKey === 'web-push') {
    const deviceCount = await prisma.userDevice.count({
      where: { userId: user.id, platform: 'web' },
    });

    if (deviceCount > 0) {
      const result = await enqueueCentralNotification({
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
      });

      if (!result.delivered && result.error) {
        throw new Error(result.error);
      }
    } else {
      if (!decryptedConfig.vapidPublicKey || !decryptedConfig.vapidPrivateKey) {
        throw new Error('VAPID cryptographic keys are not generated yet.');
      }
      return {
        success: true,
        message:
          'VAPID keys verified! Enable push notifications in your profile or mobile browser to receive live alerts.',
      };
    }
  }

  await logAudit({
    action: 'notification_provider.tested',
    entityType: 'USER',
    entityId: user.id,
    actorId: user.id,
    details: { provider: normalizedKey },
  });

  return {
    success: true,
    message: `Test notification sent successfully via ${providerKey.toUpperCase()}`,
  };
}

/**
 * Re-collect admin health diagnostic report
 */
export async function refreshAdminHealthAction(): Promise<{
  report: import('@/lib/admin-health').AdminHealthReport;
}> {
  await assertAdmin();
  const { collectAdminHealth } = await import('@/lib/admin-health');
  const report = await collectAdminHealth({ force: true });
  return { report };
}

/**
 * Re-evaluate a single admin health check by ID
 */
export async function refreshSingleHealthCheckAction(checkId: string): Promise<{
  check: import('@/lib/admin-health').AdminHealthCheck | null;
  report: import('@/lib/admin-health').AdminHealthReport;
}> {
  await assertAdmin();
  const { collectAdminHealth } = await import('@/lib/admin-health');
  const report = await collectAdminHealth({ force: true });
  const check = report.checks.find(c => c.id === checkId) || null;
  return { check, report };
}
