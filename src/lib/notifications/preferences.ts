import 'server-only';
import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  getEmailConfig,
  getSMSConfig,
  getVoiceConfig,
  getPushConfig,
  getWhatsAppConfig,
} from '@/lib/notification-providers';
import { isValidTimeZone } from '@/lib/timezone';
import { AppError } from '@/lib/errors';
import { runSerializableTransaction } from '@/lib/db-utils';
import { preconditionFailed } from '@/lib/api-v2/concurrency';

export const notificationPreferencesInput = z
  .object({
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    voiceEnabled: z.boolean(),
    whatsappEnabled: z.boolean(),
    phoneNumber: z.string().trim().min(8).max(16).nullable().optional(),
    timeZone: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.phoneNumber !== undefined &&
      value.phoneNumber !== null &&
      !/^\+[1-9]\d{1,14}$/.test(value.phoneNumber)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['phoneNumber'],
        message: 'Phone number must be in E.164 format (e.g., +1234567890)',
      });
    }
    if (value.timeZone !== undefined && !isValidTimeZone(value.timeZone)) {
      ctx.addIssue({
        code: 'custom',
        path: ['timeZone'],
        message: 'Select a valid IANA timezone.',
      });
    }
  });

const select = {
  id: true,
  revision: true,
  timeZone: true,
  phoneNumber: true,
  emailNotificationsEnabled: true,
  smsNotificationsEnabled: true,
  pushNotificationsEnabled: true,
  voiceNotificationsEnabled: true,
  whatsappNotificationsEnabled: true,
} satisfies Prisma.UserSelect;

export type NotificationPreferenceView = Prisma.UserGetPayload<{ select: typeof select }>;
export type NotificationProviderAvailability = {
  email: boolean;
  sms: boolean;
  push: boolean;
  voice: boolean;
  whatsapp: boolean;
};

export async function prepareNotificationProviderAvailability(
  requested?: Partial<z.output<typeof notificationPreferencesInput>>
): Promise<NotificationProviderAvailability> {
  const [email, sms, push, voice, whatsapp] = await Promise.all([
    requested?.emailEnabled ? getEmailConfig().then(value => value.enabled) : false,
    requested?.smsEnabled ? getSMSConfig().then(value => value.enabled) : false,
    requested?.pushEnabled ? getPushConfig().then(value => value.enabled) : false,
    requested?.voiceEnabled ? getVoiceConfig().then(value => value.enabled) : false,
    requested?.whatsappEnabled ? getWhatsAppConfig().then(value => value.enabled) : false,
  ]);
  return { email, sms, push, voice, whatsapp };
}

export async function readNotificationPreferences(
  userId: string,
  tx: Prisma.TransactionClient = prisma
) {
  const result = await tx.user.findUnique({ where: { id: userId }, select });
  if (!result) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'User not found.' });
  return result;
}

export async function updateNotificationPreferences(
  userId: string,
  raw: z.input<typeof notificationPreferencesInput>,
  options: {
    expectedRevision?: number;
    client?: Prisma.TransactionClient;
    availability?: NotificationProviderAvailability;
    actorApiKeyId?: string;
  } = {}
) {
  const parsed = notificationPreferencesInput.safeParse(raw);
  if (!parsed.success)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: parsed.error.issues[0]?.message ?? 'Invalid notification preferences.',
    });
  const input = parsed.data;
  const available = options.availability ?? (await prepareNotificationProviderAvailability(input));
  for (const [enabled, provider, label] of [
    [input.emailEnabled, available.email, 'Email'],
    [input.smsEnabled, available.sms, 'SMS'],
    [input.pushEnabled, available.push, 'Push'],
    [input.voiceEnabled, available.voice, 'Voice'],
    [input.whatsappEnabled, available.whatsapp, 'WhatsApp'],
  ] as const) {
    if (enabled && !provider) {
      const message =
        label === 'Email'
          ? 'Email notifications cannot be enabled because no email provider is configured.'
          : label === 'SMS'
            ? 'SMS notifications cannot be enabled because no SMS provider is configured.'
            : label === 'Push'
              ? 'Push notifications cannot be enabled because no push notification provider is configured.'
              : label === 'Voice'
                ? 'Voice notifications cannot be enabled because Twilio Voice is not configured.'
                : 'WhatsApp notifications cannot be enabled because no WhatsApp provider is configured.';
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: message });
    }
  }
  const operation = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const current = await readNotificationPreferences(userId, tx);
    if (options.expectedRevision !== undefined && current.revision !== options.expectedRevision)
      throw preconditionFailed();
    const effectivePhone =
      input.phoneNumber === undefined ? current.phoneNumber : input.phoneNumber;
    if ((input.smsEnabled || input.voiceEnabled || input.whatsappEnabled) && !effectivePhone)
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage:
          'A valid phone number is required when SMS, Voice, or WhatsApp notifications are enabled.',
      });
    const next = {
      emailNotificationsEnabled: input.emailEnabled,
      smsNotificationsEnabled: input.smsEnabled,
      pushNotificationsEnabled: input.pushEnabled,
      voiceNotificationsEnabled: input.voiceEnabled,
      whatsappNotificationsEnabled: input.whatsappEnabled,
      ...(input.phoneNumber !== undefined ? { phoneNumber: effectivePhone } : {}),
      ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
    };
    const changed =
      current.emailNotificationsEnabled !== input.emailEnabled ||
      current.smsNotificationsEnabled !== input.smsEnabled ||
      current.pushNotificationsEnabled !== input.pushEnabled ||
      current.voiceNotificationsEnabled !== input.voiceEnabled ||
      current.whatsappNotificationsEnabled !== input.whatsappEnabled ||
      (input.phoneNumber !== undefined && current.phoneNumber !== input.phoneNumber) ||
      (input.timeZone !== undefined && current.timeZone !== input.timeZone);
    if (!changed) return current;
    const updated = await tx.user.update({ where: { id: userId }, data: next, select });
    await logAudit(
      {
        action: 'user.notification_preferences.updated',
        entityType: 'USER',
        entityId: userId,
        actorId: userId,
        source: options.actorApiKeyId ? 'API' : 'UI',
        oldValue: {
          emailNotificationsEnabled: current.emailNotificationsEnabled,
          smsNotificationsEnabled: current.smsNotificationsEnabled,
          pushNotificationsEnabled: current.pushNotificationsEnabled,
          voiceNotificationsEnabled: current.voiceNotificationsEnabled,
          whatsappNotificationsEnabled: current.whatsappNotificationsEnabled,
          timeZone: current.timeZone,
          hasPhoneNumber: Boolean(current.phoneNumber),
        },
        newValue: {
          emailNotificationsEnabled: updated.emailNotificationsEnabled,
          smsNotificationsEnabled: updated.smsNotificationsEnabled,
          pushNotificationsEnabled: updated.pushNotificationsEnabled,
          voiceNotificationsEnabled: updated.voiceNotificationsEnabled,
          whatsappNotificationsEnabled: updated.whatsappNotificationsEnabled,
          timeZone: updated.timeZone,
          hasPhoneNumber: Boolean(updated.phoneNumber),
        },
        details: options.actorApiKeyId ? { apiClientId: options.actorApiKeyId } : undefined,
      },
      tx
    );
    return updated;
  };
  return options.client ? operation(options.client) : runSerializableTransaction(operation);
}
