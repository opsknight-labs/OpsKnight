import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import prisma from '@/lib/prisma';
import {
  SECRET_MASK,
  decryptProviderConfig,
  encryptProviderConfig,
  mergeSensitiveProviderFields,
} from '@/lib/encrypted-provider-config';

function isProviderConfig(config: unknown): config is Record<string, unknown> {
  return typeof config === 'object' && config !== null;
}

type NotificationSettingsPayload = {
  sms?: {
    enabled?: boolean;
    provider?: 'twilio' | 'aws-sns';
    accountSid?: string;
    authToken?: string;
    fromNumber?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  push?: {
    enabled?: boolean;
    vapidPublicKey?: string;
    vapidPrivateKey?: string;
    vapidSubject?: string;
  };
  whatsapp?: {
    number?: string;
    contentSid?: string;
    enabled?: boolean;
    accountSid?: string;
    authToken?: string;
  };
};

/**
 * GET /api/settings/notifications
 * Get notification provider settings from database
 */
export async function GET(_req: NextRequest) {
  try {
    await assertAdmin();

    const [twilioProvider, awsProvider, webPushProvider] = await Promise.all([
      prisma.notificationProvider.findUnique({ where: { provider: 'twilio' } }),
      prisma.notificationProvider.findUnique({ where: { provider: 'aws-sns' } }),
      prisma.notificationProvider.findUnique({ where: { provider: 'web-push' } }),
    ]);

    let smsConfig: Record<string, unknown> = { enabled: false, provider: null };
    if (twilioProvider?.enabled && isProviderConfig(twilioProvider.config)) {
      const config = await decryptProviderConfig('twilio', twilioProvider.config);
      smsConfig = {
        enabled: true,
        provider: 'twilio',
        accountSid: config.accountSid ? SECRET_MASK : '',
        hasAccountSid: Boolean(config.accountSid),
        authToken: config.authToken ? SECRET_MASK : '',
        hasAuthToken: Boolean(config.authToken),
        fromNumber: config.fromNumber || '',
      };
    } else if (awsProvider?.enabled && isProviderConfig(awsProvider.config)) {
      const config = await decryptProviderConfig('aws-sns', awsProvider.config);
      smsConfig = {
        enabled: true,
        provider: 'aws-sns',
        region: config.region || 'us-east-1',
        accessKeyId: config.accessKeyId ? SECRET_MASK : '',
        hasAccessKeyId: Boolean(config.accessKeyId),
        secretAccessKey: config.secretAccessKey ? SECRET_MASK : '',
        hasSecretAccessKey: Boolean(config.secretAccessKey),
      };
    }

    let pushConfig: Record<string, unknown> = { enabled: false, provider: null };
    if (webPushProvider?.enabled && isProviderConfig(webPushProvider.config)) {
      const config = await decryptProviderConfig('web-push', webPushProvider.config);
      pushConfig = {
        enabled: true,
        provider: 'web-push',
        vapidPublicKey: config.vapidPublicKey || '',
        vapidPrivateKey: config.vapidPrivateKey ? SECRET_MASK : '',
        hasVapidPrivateKey: Boolean(config.vapidPrivateKey),
        vapidSubject: config.vapidSubject || '',
      };
    }

    let whatsappConfig: Record<string, unknown> = {
      number: '',
      contentSid: '',
      accountSid: '',
      authToken: '',
      enabled: false,
    };
    if (twilioProvider && isProviderConfig(twilioProvider.config)) {
      const decryptedConfig = await decryptProviderConfig('twilio', twilioProvider.config);
      const whatsappNumber = decryptedConfig.whatsappNumber || '';
      const whatsappContentSid = decryptedConfig.whatsappContentSid || '';
      const whatsappEnabled = decryptedConfig.whatsappEnabled ?? Boolean(whatsappNumber);
      whatsappConfig = {
        number: whatsappNumber,
        contentSid: whatsappContentSid,
        accountSid: decryptedConfig.whatsappAccountSid ? SECRET_MASK : '',
        hasAccountSid: Boolean(decryptedConfig.whatsappAccountSid),
        authToken: decryptedConfig.whatsappAuthToken ? SECRET_MASK : '',
        hasAuthToken: Boolean(decryptedConfig.whatsappAuthToken),
        enabled: Boolean(whatsappEnabled) && Boolean(whatsappNumber),
      };
    }

    return jsonOk({ sms: smsConfig, push: pushConfig, whatsapp: whatsappConfig });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to fetch notification settings', 500);
  }
}

/**
 * POST /api/settings/notifications
 * Update notification provider settings in database
 */
export async function POST(req: NextRequest) {
  try {
    const user = await assertAdmin();

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }
    if (!rawBody || typeof rawBody !== 'object') {
      return jsonError(
        new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Invalid notification settings.' })
      );
    }
    const body = rawBody as NotificationSettingsPayload;

    const existingTwilioProvider = await prisma.notificationProvider.findUnique({
      where: { provider: 'twilio' },
    });
    const existingTwilioConfig = isProviderConfig(existingTwilioProvider?.config)
      ? await decryptProviderConfig('twilio', existingTwilioProvider.config)
      : {};

    if (body.sms) {
      if (body.sms.provider !== 'twilio' && body.sms.provider !== 'aws-sns') {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'Invalid SMS provider.',
            fields: [
              { field: 'sms.provider', code: 'invalid', message: 'Invalid SMS provider.' },
            ],
          })
        );
      }

      const smsProvider = body.sms.provider;
      const existingSmsProvider =
        smsProvider === 'twilio'
          ? existingTwilioProvider
          : await prisma.notificationProvider.findUnique({ where: { provider: smsProvider } });
      const existingSmsConfig = isProviderConfig(existingSmsProvider?.config)
        ? await decryptProviderConfig(smsProvider, existingSmsProvider.config)
        : {};
      let smsConfig: Record<string, unknown> = { enabled: body.sms.enabled || false };

      if (smsProvider === 'twilio') {
        smsConfig.accountSid = body.sms.accountSid || '';
        smsConfig.authToken = body.sms.authToken || '';
        smsConfig.fromNumber = body.sms.fromNumber || '';
        const whatsappNumber = body.whatsapp?.number ?? existingTwilioConfig.whatsappNumber ?? '';
        smsConfig.whatsappNumber = whatsappNumber;
        smsConfig.whatsappContentSid =
          body.whatsapp?.contentSid ?? existingTwilioConfig.whatsappContentSid ?? '';
        smsConfig.whatsappEnabled =
          body.whatsapp?.enabled ?? existingTwilioConfig.whatsappEnabled ?? Boolean(whatsappNumber);
        smsConfig.whatsappAccountSid =
          body.whatsapp?.accountSid ?? existingTwilioConfig.whatsappAccountSid ?? '';
        smsConfig.whatsappAuthToken =
          body.whatsapp?.authToken ?? existingTwilioConfig.whatsappAuthToken ?? '';
      } else {
        smsConfig.region = body.sms.region || 'us-east-1';
        smsConfig.accessKeyId = body.sms.accessKeyId || '';
        smsConfig.secretAccessKey = body.sms.secretAccessKey || '';
      }

      smsConfig = mergeSensitiveProviderFields(smsProvider, smsConfig, existingSmsConfig);
      smsConfig = await encryptProviderConfig(smsProvider, smsConfig);

      await prisma.notificationProvider.upsert({
        where: { provider: smsProvider },
        create: {
          provider: smsProvider,
          enabled: smsConfig.enabled as boolean,
          config: smsConfig as Prisma.InputJsonValue,
          updatedBy: user.id,
        },
        update: {
          enabled: smsConfig.enabled as boolean,
          config: smsConfig as Prisma.InputJsonValue,
          updatedBy: user.id,
        },
      });

      const otherProvider = smsProvider === 'twilio' ? 'aws-sns' : 'twilio';
      const otherProviderRecord = await prisma.notificationProvider.findUnique({
        where: { provider: otherProvider },
      });
      if (otherProviderRecord) {
        await prisma.notificationProvider.update({
          where: { provider: otherProvider },
          data: { enabled: false, updatedBy: user.id },
        });
      }
    }

    if (body.push) {
      let pushConfig: Record<string, unknown> = {
        enabled: body.push.enabled || false,
        vapidPublicKey: body.push.vapidPublicKey || '',
        vapidPrivateKey: body.push.vapidPrivateKey || '',
        vapidSubject: body.push.vapidSubject || '',
      };

      const existingPushProvider = await prisma.notificationProvider.findUnique({
        where: { provider: 'web-push' },
      });
      const existingPushConfig = isProviderConfig(existingPushProvider?.config)
        ? await decryptProviderConfig('web-push', existingPushProvider.config)
        : {};
      pushConfig = mergeSensitiveProviderFields('web-push', pushConfig, existingPushConfig);
      pushConfig = await encryptProviderConfig('web-push', pushConfig);

      await prisma.notificationProvider.upsert({
        where: { provider: 'web-push' },
        create: {
          provider: 'web-push',
          enabled: pushConfig.enabled as boolean,
          config: pushConfig as Prisma.InputJsonValue,
          updatedBy: user.id,
        },
        update: {
          enabled: pushConfig.enabled as boolean,
          config: pushConfig as Prisma.InputJsonValue,
          updatedBy: user.id,
        },
      });
    }

    if (body.whatsapp) {
      const whatsappNumber = body.whatsapp.number ?? existingTwilioConfig.whatsappNumber ?? '';
      let updatedTwilioConfig: Record<string, unknown> = {
        ...existingTwilioConfig,
        whatsappNumber,
        whatsappContentSid:
          body.whatsapp.contentSid ?? existingTwilioConfig.whatsappContentSid ?? '',
        whatsappEnabled:
          body.whatsapp.enabled ?? existingTwilioConfig.whatsappEnabled ?? Boolean(whatsappNumber),
        whatsappAccountSid:
          body.whatsapp.accountSid ?? existingTwilioConfig.whatsappAccountSid ?? '',
        whatsappAuthToken: body.whatsapp.authToken ?? existingTwilioConfig.whatsappAuthToken ?? '',
      };

      updatedTwilioConfig = mergeSensitiveProviderFields(
        'twilio',
        updatedTwilioConfig,
        existingTwilioConfig
      );
      updatedTwilioConfig = await encryptProviderConfig('twilio', updatedTwilioConfig);

      if (existingTwilioProvider) {
        await prisma.notificationProvider.update({
          where: { provider: 'twilio' },
          data: {
            config: updatedTwilioConfig as Prisma.InputJsonValue,
            updatedBy: user.id,
          },
        });
      } else {
        await prisma.notificationProvider.create({
          data: {
            provider: 'twilio',
            enabled: false,
            config: updatedTwilioConfig as Prisma.InputJsonValue,
            updatedBy: user.id,
          },
        });
      }
    }

    return jsonOk({
      success: true,
      message: 'Notification provider settings saved successfully',
    });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to save notification settings', 500);
  }
}
