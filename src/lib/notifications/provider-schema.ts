import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';

export const notificationProviderKeys = [
  'twilio',
  'aws-sns',
  'resend',
  'sendgrid',
  'smtp',
  'ses',
  'web-push',
] as const;
export const notificationProviderKeySchema = z.enum(notificationProviderKeys);
export type NotificationProviderKey = z.infer<typeof notificationProviderKeySchema>;

const secret = z.string().max(2048);
const label = z.string().trim().max(256);
const email = z.string().trim().email().max(320);
const configSchemas = {
  twilio: z
    .object({
      accountSid: secret.optional(),
      authToken: secret.optional(),
      fromNumber: label.optional(),
      voiceEnabled: z.boolean().optional(),
      whatsappNumber: label.optional(),
      whatsappContentSid: label.optional(),
      whatsappEnabled: z.boolean().optional(),
      whatsappAccountSid: secret.optional(),
      whatsappAuthToken: secret.optional(),
    })
    .strict(),
  'aws-sns': z
    .object({
      region: z
        .string()
        .regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/)
        .optional(),
      accessKeyId: secret.optional(),
      secretAccessKey: secret.optional(),
    })
    .strict(),
  resend: z.object({ apiKey: secret.optional(), fromEmail: email.optional() }).strict(),
  sendgrid: z.object({ apiKey: secret.optional(), fromEmail: email.optional() }).strict(),
  smtp: z
    .object({
      host: z
        .string()
        .trim()
        .min(1)
        .max(253)
        .refine(
          value => !/[\s\u0000-\u001f]/.test(value),
          'SMTP host must be a hostname or IP literal.'
        )
        .optional(),
      port: z.union([z.number().int().min(1).max(65535), z.string().regex(/^\d{1,5}$/)]).optional(),
      user: label.optional(),
      password: secret.optional(),
      secure: z.boolean().optional(),
      fromEmail: email.optional(),
    })
    .strict(),
  ses: z
    .object({
      region: z
        .string()
        .regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/)
        .optional(),
      accessKeyId: secret.optional(),
      secretAccessKey: secret.optional(),
      fromEmail: email.optional(),
    })
    .strict(),
  'web-push': z
    .object({
      vapidPublicKey: secret.optional(),
      vapidPrivateKey: secret.optional(),
      vapidSubject: z.string().trim().max(320).optional(),
      vapidKeyHistory: z
        .array(z.object({ publicKey: secret, privateKey: secret }).strict())
        .max(3)
        .optional(),
    })
    .strict(),
} satisfies Record<NotificationProviderKey, z.ZodTypeAny>;

export function notificationProviderConfigSchema(provider: NotificationProviderKey) {
  // provider is a closed zod enum, not a request-controlled property name.
  // eslint-disable-next-line security/detect-object-injection
  return configSchemas[provider];
}

export function notificationProviderConfigurationInput() {
  const webPush = configSchemas['web-push'].omit({
    vapidPrivateKey: true,
    vapidKeyHistory: true,
  });
  return z.discriminatedUnion('provider', [
    z
      .object({ provider: z.literal('twilio'), enabled: z.boolean(), config: configSchemas.twilio })
      .strict(),
    z
      .object({
        provider: z.literal('aws-sns'),
        enabled: z.boolean(),
        config: configSchemas['aws-sns'],
      })
      .strict(),
    z
      .object({ provider: z.literal('resend'), enabled: z.boolean(), config: configSchemas.resend })
      .strict(),
    z
      .object({
        provider: z.literal('sendgrid'),
        enabled: z.boolean(),
        config: configSchemas.sendgrid,
      })
      .strict(),
    z
      .object({ provider: z.literal('smtp'), enabled: z.boolean(), config: configSchemas.smtp })
      .strict(),
    z
      .object({ provider: z.literal('ses'), enabled: z.boolean(), config: configSchemas.ses })
      .strict(),
    z.object({ provider: z.literal('web-push'), enabled: z.boolean(), config: webPush }).strict(),
  ]);
}

export function assertProviderConfigReady(
  provider: NotificationProviderKey,
  config: Record<string, unknown>
) {
  const required: Record<NotificationProviderKey, readonly string[]> = {
    twilio: ['accountSid', 'authToken', 'fromNumber'],
    'aws-sns': ['region', 'accessKeyId', 'secretAccessKey'],
    resend: ['apiKey', 'fromEmail'],
    sendgrid: ['apiKey', 'fromEmail'],
    smtp: ['host', 'port', 'user', 'password', 'fromEmail'],
    ses: ['region', 'accessKeyId', 'secretAccessKey', 'fromEmail'],
    'web-push': ['vapidPublicKey', 'vapidPrivateKey', 'vapidSubject'],
  };
  // Both indexes are selected from closed provider/field registries above.
  // eslint-disable-next-line security/detect-object-injection
  const missing = required[provider].filter(key => {
    // eslint-disable-next-line security/detect-object-injection
    const value = config[key];
    return value === undefined || value === null || value === '' || value === '********';
  });
  if (missing.length) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: `Provider configuration is incomplete; required fields are missing: ${missing.join(', ')}.`,
    });
  }
}
