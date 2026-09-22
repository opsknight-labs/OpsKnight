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
): Promise<import('@/lib/provider-test-service').ProviderTestResult> {
  try {
    await assertAdmin();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Unauthorized. Admin access required.'
    );
  }

  const user = await getCurrentUser();
  const { executeProviderTest } = await import('@/lib/provider-test-service');
  return executeProviderTest(providerKey, user);
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
