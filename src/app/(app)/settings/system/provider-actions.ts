'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { decryptProviderConfig, encryptProviderConfig } from '@/lib/encrypted-provider-config';
import { notificationProviderKeySchema } from '@/lib/notifications/provider-schema';
import { saveNotificationProvider } from '@/lib/notifications/providers';

const SUPPORTED_PROVIDERS = new Set([
  'twilio',
  'aws-sns',
  'resend',
  'sendgrid',
  'smtp',
  'ses',
  'web-push',
]);

class SettingsChangedError extends Error {
  readonly code = 'SETTINGS_CHANGED';

  constructor() {
    super('Settings changed elsewhere. Reload before saving.');
    this.name = 'SettingsChangedError';
  }
}

function parseExpectedUpdatedAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid settings revision. Reload the page and try again.');
  }
  return parsed;
}

async function getCommittedUpdatedAt(id: string): Promise<string> {
  const committed = await prisma.notificationProvider.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return committed.updatedAt.toISOString();
}

async function recoverableExistingConfig(provider: string, config: Record<string, unknown> | null) {
  if (!config) return { config: {}, recoveredFromDecryptionError: false };
  try {
    return {
      config: await decryptProviderConfig(provider, config),
      recoveredFromDecryptionError: false,
    };
  } catch {
    // Never reuse unreadable ciphertext as though it were plaintext. An administrator
    // may disable the provider or replace every secret with a new value.
    return { config: {}, recoveredFromDecryptionError: true };
  }
}

/**
 * Atomic notification-provider mutation contract.
 *
 * Existing records require the revision returned by getNotificationProviders().
 * The conditional update prevents a stale administrator from silently replacing
 * a newer provider configuration. Mutation and audit are committed together.
 */
export async function updateNotificationProvider(
  providerId: string | null,
  provider: string,
  enabled: boolean,
  config: Record<string, unknown>,
  expectedUpdatedAt?: string | null
): Promise<{ success: true; updatedAt: string }> {
  await assertAdmin();
  const normalizedProvider = provider.trim().toLowerCase();
  const parsedProvider = notificationProviderKeySchema.safeParse(normalizedProvider);
  if (!parsedProvider.success || !SUPPORTED_PROVIDERS.has(normalizedProvider)) {
    throw new Error(`Unsupported notification provider '${provider}'.`);
  }
  const user = await getCurrentUser();
  const existingProvider = providerId
    ? await prisma.notificationProvider.findUnique({ where: { id: providerId } })
    : await prisma.notificationProvider.findUnique({ where: { provider: normalizedProvider } });
  if (providerId && !existingProvider) {
    throw new SettingsChangedError();
  }
  if (existingProvider && existingProvider.provider !== normalizedProvider) {
    throw new Error('Provider identity does not match the stored configuration. Reload the page.');
  }

  const expectedTimestamp = parseExpectedUpdatedAt(expectedUpdatedAt);
  if (existingProvider && !expectedTimestamp) {
    throw new Error('Settings revision is required. Reload the page and try again.');
  }
  if (!existingProvider && expectedTimestamp) {
    throw new SettingsChangedError();
  }
  if (existingProvider && expectedTimestamp?.getTime() !== existingProvider.updatedAt.getTime()) {
    throw new SettingsChangedError();
  }
  const result = await saveNotificationProvider({
    provider: parsedProvider.data,
    enabled,
    config,
    actorId: user.id,
    expectedRevision: existingProvider?.revision ?? null,
  });
  revalidatePath('/settings/system');
  revalidatePath('/settings/notifications');
  return { success: true, updatedAt: result.updatedAt };
}

export async function generateVapidKeys(options?: {
  subject?: string;
  rotate?: boolean;
  keepPrevious?: boolean;
  expectedUpdatedAt?: string | null;
}): Promise<{
  publicKey: string;
  subject: string;
  updatedAt: string;
}> {
  await assertAdmin();

  const user = await getCurrentUser();
  const existing = await prisma.notificationProvider.findUnique({
    where: { provider: 'web-push' },
  });
  const expectedRevision = parseExpectedUpdatedAt(options?.expectedUpdatedAt);
  if (existing && !expectedRevision) {
    throw new Error('Settings revision is required. Reload the page and try again.');
  }
  if (!existing && expectedRevision) {
    throw new SettingsChangedError();
  }

  const recovered = await recoverableExistingConfig(
    'web-push',
    (existing?.config as Record<string, unknown> | undefined) ?? null
  );
  const existingConfig = recovered.config;
  const previousKeys = Array.isArray(existingConfig.vapidKeyHistory)
    ? (existingConfig.vapidKeyHistory as Array<{ publicKey: string; privateKey: string }>)
    : [];

  const { generateVAPIDKeys } = await import('web-push');
  const { publicKey, privateKey } = generateVAPIDKeys();
  const subject = options?.subject?.trim() || 'mailto:admin@example.com';
  const shouldRotate = !!options?.rotate;
  const keepPrevious = options?.keepPrevious !== false;
  const nextHistory = shouldRotate
    ? keepPrevious && existingConfig.vapidPublicKey
      ? [
          {
            publicKey: String(existingConfig.vapidPublicKey),
            privateKey: String(existingConfig.vapidPrivateKey || ''),
          },
          ...previousKeys,
        ]
      : []
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

  const providerRecordId = await prisma.$transaction(async tx => {
    let id: string;
    if (existing) {
      const updateResult = await tx.notificationProvider.updateMany({
        where: { id: existing.id, updatedAt: expectedRevision! },
        data: {
          config: encryptedNextConfig as Prisma.InputJsonValue,
          updatedBy: user.id,
        },
      });
      if (updateResult.count !== 1) throw new SettingsChangedError();
      id = existing.id;
    } else {
      const created = await tx.notificationProvider.create({
        data: {
          provider: 'web-push',
          enabled: false,
          config: encryptedNextConfig as Prisma.InputJsonValue,
          updatedBy: user.id,
        },
        select: { id: true },
      });
      id = created.id;
    }

    await logAudit(
      {
        action: 'vapid_keys.rotated',
        entityType: 'SYSTEM_CONFIG',
        entityId: id,
        actorId: user.id,
        details: {
          subject,
          rotated: shouldRotate,
          recoveredFromDecryptionError: recovered.recoveredFromDecryptionError,
        },
      },
      tx
    );
    return id;
  });

  const updatedAt = await getCommittedUpdatedAt(providerRecordId);
  revalidatePath('/settings/notifications');
  revalidatePath('/settings/system');

  // The private key is encrypted and persisted above; it must never cross the
  // server-action boundary into browser state or logs.
  return { publicKey, subject, updatedAt };
}
