import 'server-only';

import { Prisma, type NotificationProvider } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import {
  encryptProviderConfig,
  decryptProviderConfig,
  maskSensitiveFields,
  SECRET_MASK,
  mergeSensitiveProviderFields,
  getProviderSensitiveFields,
} from '@/lib/encrypted-provider-config';
import { logAudit } from '@/lib/audit';
import { runSerializableTransaction } from '@/lib/db-utils';
import { preconditionFailed } from '@/lib/api-v2/concurrency';
import {
  assertProviderConfigReady,
  notificationProviderConfigSchema,
  notificationProviderKeySchema,
  type NotificationProviderKey,
} from './provider-schema';

export type NotificationProviderView = {
  id: string;
  provider: NotificationProviderKey;
  enabled: boolean;
  revision: number;
  config: Record<string, unknown>;
  configurationState: 'READY' | 'INCOMPLETE' | 'DISABLED' | 'DECRYPTION_ERROR';
  updatedAt: string;
};

function providerError() {
  return new AppError({
    code: 'RESOURCE_NOT_FOUND',
    userMessage: 'Notification provider not found.',
  });
}

async function toView(row: NotificationProvider): Promise<NotificationProviderView> {
  const provider = notificationProviderKeySchema.safeParse(row.provider);
  if (!provider.success) throw providerError();
  let config: Record<string, unknown> = (row.config as Record<string, unknown>) ?? {};
  let configurationState: NotificationProviderView['configurationState'] = row.enabled
    ? 'INCOMPLETE'
    : 'DISABLED';
  try {
    config = await decryptProviderConfig(provider.data, config);
    if (row.enabled) {
      try {
        assertProviderConfigReady(provider.data, config);
        configurationState = 'READY';
      } catch {
        configurationState = 'INCOMPLETE';
      }
    }
  } catch {
    configurationState = 'DECRYPTION_ERROR';
    config = {};
  }
  const masked = maskSensitiveFields(provider.data, config);
  // Key history is rotation material, not API configuration metadata.
  delete masked.vapidKeyHistory;
  return {
    id: row.id,
    provider: provider.data,
    enabled: row.enabled,
    revision: row.revision,
    config: masked,
    configurationState,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listNotificationProviders() {
  const rows = await prisma.notificationProvider.findMany({
    orderBy: { provider: 'asc' },
    take: 20,
  });
  return Promise.all(rows.map(toView));
}

export async function readNotificationProvider(provider: NotificationProviderKey) {
  const row = await prisma.notificationProvider.findUnique({ where: { provider } });
  if (!row) throw providerError();
  return toView(row);
}

function parseConfig(provider: NotificationProviderKey, value: unknown): Record<string, unknown> {
  const parsed = notificationProviderConfigSchema(provider).safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: parsed.error.issues[0]?.message ?? 'Invalid provider configuration.',
    });
  }
  return parsed.data as Record<string, unknown>;
}

function assertReplacementSecrets(
  provider: NotificationProviderKey,
  config: Record<string, unknown>
) {
  const keys: Partial<Record<NotificationProviderKey, readonly string[]>> = {
    twilio: ['accountSid', 'authToken'],
    'aws-sns': ['accessKeyId', 'secretAccessKey'],
    resend: ['apiKey'],
    sendgrid: ['apiKey'],
    smtp: ['password'],
    ses: ['accessKeyId', 'secretAccessKey'],
    'web-push': ['vapidPrivateKey'],
  };
  // provider maps through a closed enum to constant secret-field names.
  // eslint-disable-next-line security/detect-object-injection
  const missing = (keys[provider] ?? []).filter(key => {
    // eslint-disable-next-line security/detect-object-injection
    const value = config[key];
    return (
      typeof value !== 'string' || value === '' || value === SECRET_MASK || value === '********'
    );
  });
  if (missing.length) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage:
        'Stored credentials are unreadable. Supply replacement secret values before enabling this provider.',
    });
  }
}

export async function saveNotificationProvider(input: {
  provider: NotificationProviderKey;
  enabled: boolean;
  config: unknown;
  actorId: string;
  actorApiKeyId?: string;
  expectedRevision: number | null;
  client?: Prisma.TransactionClient;
}) {
  const suppliedConfig = parseConfig(input.provider, input.config);
  const existing = await prisma.notificationProvider.findUnique({
    where: { provider: input.provider },
  });
  if (existing && input.expectedRevision === null)
    throw new AppError({ code: 'PRECONDITION_REQUIRED' });
  if (!existing && input.expectedRevision !== null) throw preconditionFailed();
  if (existing && input.expectedRevision !== null && existing.revision !== input.expectedRevision)
    throw preconditionFailed();
  let oldConfig: Record<string, unknown> = {};
  let decryptionFailed = false;
  if (existing) {
    try {
      oldConfig = await decryptProviderConfig(
        input.provider,
        (existing.config as Record<string, unknown>) ?? {}
      );
    } catch {
      decryptionFailed = true;
    }
  }
  if (input.enabled && decryptionFailed) assertReplacementSecrets(input.provider, suppliedConfig);
  const configWithRetainedSecrets = { ...suppliedConfig };
  for (const field of getProviderSensitiveFields(input.provider)) {
    if (!(field in configWithRetainedSecrets) && field in oldConfig) {
      // field is returned only by the fixed sensitive-field allowlist.
      // eslint-disable-next-line security/detect-object-injection
      configWithRetainedSecrets[field] = oldConfig[field];
    }
  }
  const merged = mergeSensitiveProviderFields(input.provider, configWithRetainedSecrets, oldConfig);
  if (input.enabled) assertProviderConfigReady(input.provider, merged);
  const encrypted = await encryptProviderConfig(input.provider, merged);

  const execute = async (tx: Prisma.TransactionClient) => {
    const locked = await tx.notificationProvider.findUnique({
      where: { provider: input.provider },
    });
    const admin = await tx.user.findFirst({
      where: { id: input.actorId, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!admin) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
    let row: NotificationProvider;
    if (locked) {
      if (input.expectedRevision === null) throw new AppError({ code: 'PRECONDITION_REQUIRED' });
      const changed = await tx.notificationProvider.updateMany({
        where: { id: locked.id, provider: input.provider, revision: input.expectedRevision },
        data: {
          enabled: input.enabled,
          config: encrypted as Prisma.InputJsonValue,
          updatedBy: input.actorId,
        },
      });
      if (changed.count !== 1) throw preconditionFailed();
      row = await tx.notificationProvider.findUniqueOrThrow({ where: { id: locked.id } });
    } else {
      if (input.expectedRevision !== null) throw preconditionFailed();
      try {
        row = await tx.notificationProvider.create({
          data: {
            provider: input.provider,
            enabled: input.enabled,
            config: encrypted as Prisma.InputJsonValue,
            updatedBy: input.actorId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          if (!input.client) throw preconditionFailed();
        throw error;
      }
    }
    await logAudit(
      {
        action: 'notification_provider.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: row.id,
        actorId: input.actorId,
        details: {
          provider: input.provider,
          enabled: input.enabled,
          recoveredFromDecryptionError: decryptionFailed,
          ...(input.actorApiKeyId ? { apiKeyId: input.actorApiKeyId } : {}),
        },
      },
      tx
    );
    return row;
  };
  const row = input.client
    ? await execute(input.client)
    : await runSerializableTransaction(execute);
  return toView(row);
}

export async function notificationProviderDiagnostics(provider: NotificationProviderKey) {
  const [view, latestTests] = await Promise.all([
    readNotificationProvider(provider),
    prisma.notification.findMany({
      where: {
        eventType: 'provider-test',
        category: 'SYSTEM',
        message: { contains: provider.toUpperCase() },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        createdAt: true,
        channel: true,
        deliveryAttempts: { orderBy: { ordinal: 'desc' }, take: 1, select: { errorCode: true } },
      },
    }),
  ]);
  const secretFields = new Set(getProviderSensitiveFields(provider));
  const missingRequiredFields =
    view.configurationState === 'DECRYPTION_ERROR'
      ? ['credentials-unreadable']
      : view.configurationState === 'INCOMPLETE'
        ? requiredFields(provider).filter(field => {
            const flag = `has${field.charAt(0).toUpperCase()}${field.slice(1)}`;
            const hasField = secretFields.has(field)
              ? // eslint-disable-next-line security/detect-object-injection -- flag is derived from a field in the closed provider allowlist.
                view.config[flag] === true
              : // eslint-disable-next-line security/detect-object-injection -- field is from the closed provider's required-field table.
                Boolean(view.config[field]);
            return !hasField;
          })
        : [];
  return {
    provider: view.provider,
    enabled: view.enabled,
    configurationState: view.configurationState,
    missingRequiredFields,
    recentTests: latestTests.map(test => ({
      id: test.id,
      status: test.status,
      channel: test.channel,
      createdAt: test.createdAt.toISOString(),
      errorCode: test.deliveryAttempts[0]?.errorCode ?? null,
    })),
  };
}

export async function rotateWebPushKeys(input: {
  subject: string;
  keepPrevious: boolean;
  actorId: string;
  actorApiKeyId?: string;
  expectedRevision: number;
  client?: Prisma.TransactionClient;
}) {
  const existing = await prisma.notificationProvider.findUnique({
    where: { provider: 'web-push' },
  });
  if (!existing) throw providerError();
  if (existing.revision !== input.expectedRevision) throw preconditionFailed();
  let old: Record<string, unknown>;
  try {
    old = await decryptProviderConfig(
      'web-push',
      (existing.config as Record<string, unknown>) ?? {}
    );
  } catch {
    old = {};
  }
  const { generateVAPIDKeys } = await import('web-push');
  const keys = generateVAPIDKeys();
  const oldHistory = Array.isArray(old.vapidKeyHistory)
    ? (old.vapidKeyHistory as Array<{ publicKey: string; privateKey: string }>)
    : [];
  const history = input.keepPrevious
    ? [
        ...(old.vapidPublicKey && old.vapidPrivateKey
          ? [{ publicKey: String(old.vapidPublicKey), privateKey: String(old.vapidPrivateKey) }]
          : []),
        ...oldHistory,
      ]
        .filter(
          (entry, index, all) =>
            all.findIndex(candidate => candidate.publicKey === entry.publicKey) === index
        )
        .slice(0, 3)
    : [];
  const config = await encryptProviderConfig('web-push', {
    ...old,
    vapidPublicKey: keys.publicKey,
    vapidPrivateKey: keys.privateKey,
    vapidSubject: input.subject,
    vapidKeyHistory: history,
  });
  const execute = async (tx: Prisma.TransactionClient) => {
    const admin = await tx.user.findFirst({
      where: { id: input.actorId, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!admin) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
    const changed = await tx.notificationProvider.updateMany({
      where: { id: existing.id, provider: 'web-push', revision: input.expectedRevision },
      data: { config: config as Prisma.InputJsonValue, updatedBy: input.actorId },
    });
    if (changed.count !== 1) throw preconditionFailed();
    const updated = await tx.notificationProvider.findUniqueOrThrow({ where: { id: existing.id } });
    await logAudit(
      {
        action: 'vapid_keys.rotated',
        entityType: 'SYSTEM_CONFIG',
        entityId: updated.id,
        actorId: input.actorId,
        details: {
          rotated: true,
          previousKeyRetained: history.length > 0,
          ...(input.actorApiKeyId ? { apiKeyId: input.actorApiKeyId } : {}),
        },
      },
      tx
    );
    return updated;
  };
  const row = input.client
    ? await execute(input.client)
    : await runSerializableTransaction(execute);
  return { publicKey: keys.publicKey, subject: input.subject, provider: await toView(row) };
}

function requiredFields(provider: NotificationProviderKey): readonly string[] {
  const fields: Record<NotificationProviderKey, readonly string[]> = {
    twilio: ['accountSid', 'authToken', 'fromNumber'],
    'aws-sns': ['region', 'accessKeyId', 'secretAccessKey'],
    resend: ['apiKey', 'fromEmail'],
    sendgrid: ['apiKey', 'fromEmail'],
    smtp: ['host', 'port', 'user', 'password', 'fromEmail'],
    ses: ['region', 'accessKeyId', 'secretAccessKey', 'fromEmail'],
    'web-push': ['vapidPublicKey', 'vapidPrivateKey', 'vapidSubject'],
  };
  // provider is the parsed closed enum.
  // eslint-disable-next-line security/detect-object-injection
  return fields[provider];
}
