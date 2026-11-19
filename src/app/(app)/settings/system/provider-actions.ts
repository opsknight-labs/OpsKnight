'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { decryptProviderConfig, encryptProviderConfig } from '@/lib/encrypted-provider-config';
import { notificationProviderKeySchema } from '@/lib/notifications/provider-schema';
import { saveNotificationProvider } from '@/lib/notifications/providers';
import { AppError } from '@/lib/errors';
import { SettingsChangedMutationError } from '@/lib/settings-result';
import { settingsActionFailure, type SettingsActionFailure } from '@/lib/settings-action-errors';

const SUPPORTED_PROVIDERS = new Set([
  'twilio',
  'aws-sns',
  'resend',
  'sendgrid',
  'smtp',
  'ses',
  'web-push',
]);

export type UpdateNotificationProviderResult =
  | { success: true; error: null; updatedAt: string }
  | SettingsActionFailure;

export type GenerateVapidKeysResult =
  | { success: true; error: null; publicKey: string; subject: string; updatedAt: string }
  | SettingsActionFailure;

function invalidRequest(userMessage: string): AppError {
  return new AppError({ code: 'VALIDATION_FAILED', userMessage });
}

function parseExpectedUpdatedAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalidRequest('Invalid settings revision. Reload the page and try again.');
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
 *
 * Failures are returned, never thrown: Next.js redacts thrown server-action
 * errors in production (React error #441), which hid the real message.
 */
export async function updateNotificationProvider(
  providerId: string | null,
  provider: string,
  enabled: boolean,
  config: Record<string, unknown>,
  expectedUpdatedAt?: string | null
): Promise<UpdateNotificationProviderResult> {
  try {
    const updatedAt = await persistNotificationProvider(
      providerId,
      provider,
      enabled,
      config,
      expectedUpdatedAt
    );
    return { success: true, error: null, updatedAt };
  } catch (error) {
    return settingsActionFailure(error, {
      operation: 'notification_provider.save',
      fallback: 'Failed to save the provider configuration.',
    });
  }
}

async function persistNotificationProvider(
  providerId: string | null,
  provider: string,
  enabled: boolean,
  config: Record<string, unknown>,
  expectedUpdatedAt: string | null | undefined
): Promise<string> {
  await assertAdmin();
  const normalizedProvider = provider.trim().toLowerCase();
  const parsedProvider = notificationProviderKeySchema.safeParse(normalizedProvider);
  if (!parsedProvider.success || !SUPPORTED_PROVIDERS.has(normalizedProvider)) {
    throw invalidRequest(`Unsupported notification provider '${provider}'.`);
  }
  const user = await getCurrentUser();
  const existingProvider = providerId
    ? await prisma.notificationProvider.findUnique({ where: { id: providerId } })
    : await prisma.notificationProvider.findUnique({ where: { provider: normalizedProvider } });
  if (providerId && !existingProvider) {
    throw new SettingsChangedMutationError();
  }
  if (existingProvider && existingProvider.provider !== normalizedProvider) {
    throw invalidRequest(
      'Provider identity does not match the stored configuration. Reload the page.'
    );
  }

  const expectedTimestamp = parseExpectedUpdatedAt(expectedUpdatedAt);
  if (existingProvider && !expectedTimestamp) {
    throw invalidRequest('Settings revision is required. Reload the page and try again.');
  }
  if (!existingProvider && expectedTimestamp) {
    throw new SettingsChangedMutationError();
  }
  if (existingProvider && expectedTimestamp?.getTime() !== existingProvider.updatedAt.getTime()) {
    throw new SettingsChangedMutationError();
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
  return result.updatedAt;
}

export async function generateVapidKeys(options?: {
  subject?: string;
  rotate?: boolean;
  keepPrevious?: boolean;
  expectedUpdatedAt?: string | null;
}): Promise<GenerateVapidKeysResult> {
  try {
    const generated = await rotateVapidKeys(options);
    return { success: true, error: null, ...generated };
  } catch (error) {
    return settingsActionFailure(error, {
      operation: 'notification_provider.vapid_keys',
      fallback: 'Failed to generate VAPID keys.',
    });
  }
}

async function rotateVapidKeys(options?: {
  subject?: string;
  rotate?: boolean;
  keepPrevious?: boolean;
  expectedUpdatedAt?: string | null;
}): Promise<{ publicKey: string; subject: string; updatedAt: string }> {
  await assertAdmin();

  const user = await getCurrentUser();
  const existing = await prisma.notificationProvider.findUnique({
    where: { provider: 'web-push' },
  });
  const expectedRevision = parseExpectedUpdatedAt(options?.expectedUpdatedAt);
  if (existing && !expectedRevision) {
    throw invalidRequest('Settings revision is required. Reload the page and try again.');
  }
  if (!existing && expectedRevision) {
    throw new SettingsChangedMutationError();
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
      if (updateResult.count !== 1) throw new SettingsChangedMutationError();
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
