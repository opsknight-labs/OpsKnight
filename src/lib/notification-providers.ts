import prisma from './prisma';
import { logger } from './logger';
import { decryptProviderConfig } from './encrypted-provider-config';

/**
 * Type guard for provider config records
 */
function isProviderConfig(config: unknown): config is Record<string, unknown> {
  return typeof config === 'object' && config !== null;
}

/**
 * Helper to get and decrypt provider config
 */
async function getDecryptedConfig(
  provider: string,
  rawConfig: unknown
): Promise<Record<string, unknown>> {
  if (!isProviderConfig(rawConfig)) {
    return {};
  }
  try {
    return await decryptProviderConfig(provider, rawConfig);
  } catch (error) {
    logger.error('Failed to decrypt provider config', {
      component: 'notification-providers',
      provider,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return rawConfig;
  }
}

export type SMSProvider = 'twilio' | 'aws-sns' | null;
export type PushProvider = 'web-push' | null;

export interface SMSConfig {
  enabled: boolean;
  provider: SMSProvider;
  // Twilio config
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  whatsappNumber?: string; // WhatsApp Business API number (optional)
  whatsappContentSid?: string; // Twilio Content API SID for templates
  // AWS SNS config
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface PushConfig {
  enabled: boolean;
  provider: PushProvider;
  // Web Push (PWA) config
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject?: string;
  vapidKeyHistory?: Array<{ publicKey: string; privateKey: string }>;
}

export type EmailProvider = 'resend' | 'sendgrid' | 'smtp' | 'ses' | null;

export interface EmailConfig {
  enabled: boolean;
  provider: EmailProvider;
  apiKey?: string;
  password?: string;
  fromEmail?: string;
  source?: string;
  host?: string;
  accessKeyId?: string;
  user?: string;
  port?: string | number;
  secure?: boolean;
}

export type NotificationChannelType = 'EMAIL' | 'SMS' | 'PUSH' | 'WHATSAPP';

function getAppHostname(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
  if (appUrl) {
    try {
      const parsed = new URL(appUrl.startsWith('http') ? appUrl : `https://${appUrl}`);
      if (parsed.hostname && parsed.hostname !== 'localhost') {
        return parsed.hostname;
      }
    } catch {
      // ignore
    }
  }
  return 'opsknight.internal';
}

export async function getEmailConfig(): Promise<EmailConfig> {
  const defaultFromEmail = `noreply@${getAppHostname()}`;

  try {
    // Check Resend first
    const resendProvider = await prisma.notificationProvider.findUnique({
      where: { provider: 'resend' },
    });

    if (resendProvider && resendProvider.enabled && resendProvider.config) {
      const config = await getDecryptedConfig('resend', resendProvider.config);
      if (config.apiKey) {
        return {
          enabled: true,
          provider: 'resend',
          apiKey: config.apiKey as string,
          fromEmail: (config.fromEmail as string) || defaultFromEmail,
          source: 'resend',
        };
      }
    }

    // Check SendGrid
    const sendgridProvider = await prisma.notificationProvider.findUnique({
      where: { provider: 'sendgrid' },
    });

    if (sendgridProvider && sendgridProvider.enabled && sendgridProvider.config) {
      const config = await getDecryptedConfig('sendgrid', sendgridProvider.config);
      if (config.apiKey) {
        return {
          enabled: true,
          provider: 'sendgrid',
          apiKey: config.apiKey as string,
          fromEmail: (config.fromEmail as string) || defaultFromEmail,
          source: 'sendgrid',
        };
      }
    }

    // Check SMTP
    const smtpProvider = await prisma.notificationProvider.findUnique({
      where: { provider: 'smtp' },
    });

    if (smtpProvider && smtpProvider.enabled && smtpProvider.config) {
      const config = await getDecryptedConfig('smtp', smtpProvider.config);
      if (config.host && config.user && config.password) {
        return {
          enabled: true,
          provider: 'smtp',
          apiKey: config.password as string,
          password: config.password as string,
          fromEmail: (config.fromEmail as string) || defaultFromEmail,
          source: 'smtp',
          host: config.host as string,
          user: config.user as string,
          port: config.port as string | number,
          secure: config.secure === true,
        };
      }
    }

    // Check Amazon SES
    const sesProvider = await prisma.notificationProvider.findUnique({
      where: { provider: 'ses' },
    });

    if (sesProvider && sesProvider.enabled && sesProvider.config) {
      const config = await getDecryptedConfig('ses', sesProvider.config);
      if (config.accessKeyId && config.secretAccessKey) {
        return {
          enabled: true,
          provider: 'ses',
          apiKey: config.secretAccessKey as string,
          accessKeyId: config.accessKeyId as string,
          fromEmail: (config.fromEmail as string) || defaultFromEmail,
          source: 'ses',
          host: (config.region as string) || 'us-east-1',
        };
      }
    }
  } catch (error) {
    logger.error('Failed to load Email config from database', {
      component: 'notification-providers',
      error,
    });
    return { enabled: false, provider: null, source: 'error' };
  }

  return {
    enabled: false,
    provider: null,
  };
}

/**
 * Get email config for status page subscriptions
 * Respects the emailProvider setting from StatusPage
 */
export async function getStatusPageEmailConfig(statusPageId?: string): Promise<EmailConfig> {
  const defaultFromEmail = `noreply@${getAppHostname()}`;

  try {
    // Get status page email provider preference
    let preferredProvider: string | null = null;
    if (statusPageId) {
      const statusPage = await prisma.statusPage.findUnique({
        where: { id: statusPageId },
        select: { emailProvider: true },
      });
      preferredProvider = statusPage?.emailProvider || null;
    }

    // If status page has a preferred provider, try it first
    if (preferredProvider) {
      const provider = await prisma.notificationProvider.findUnique({
        where: { provider: preferredProvider },
      });

      if (provider && provider.enabled && provider.config) {
        const config = await getDecryptedConfig(preferredProvider, provider.config);
        if (preferredProvider === 'resend' && config.apiKey) {
          return {
            enabled: true,
            provider: 'resend',
            apiKey: config.apiKey as string,
            fromEmail: (config.fromEmail as string) || defaultFromEmail,
            source: 'status-page-resend',
          };
        } else if (preferredProvider === 'sendgrid' && config.apiKey) {
          return {
            enabled: true,
            provider: 'sendgrid',
            apiKey: config.apiKey as string,
            fromEmail: (config.fromEmail as string) || defaultFromEmail,
            source: 'status-page-sendgrid',
          };
        } else if (preferredProvider === 'smtp' && config.host && config.user && config.password) {
          return {
            enabled: true,
            provider: 'smtp',
            apiKey: config.password as string,
            password: config.password as string,
            fromEmail: (config.fromEmail as string) || defaultFromEmail,
            source: 'status-page-smtp',
            host: config.host as string,
            user: config.user as string,
            port: config.port as string | number,
            secure: config.secure === true,
          };
        } else if (preferredProvider === 'ses' && config.accessKeyId && config.secretAccessKey) {
          return {
            enabled: true,
            provider: 'ses',
            apiKey: config.secretAccessKey as string,
            accessKeyId: config.accessKeyId as string,
            fromEmail: (config.fromEmail as string) || defaultFromEmail,
            source: 'status-page-ses',
            host: (config.region as string) || 'us-east-1',
          };
        }
      }
    }

    // Fall back to default email config
    return await getEmailConfig();
  } catch (error) {
    logger.error('Failed to load status page email config', {
      component: 'notification-providers',
      error,
    });
    return { enabled: false, provider: null }; // Fall back to default email config
  }
}

export async function isChannelAvailable(channel: NotificationChannelType): Promise<boolean> {
  switch (channel) {
    case 'EMAIL':
      return (await getEmailConfig()).enabled;
    case 'SMS':
      return (await getSMSConfig()).enabled;
    case 'PUSH':
      return (await getPushConfig()).enabled;
    case 'WHATSAPP':
      // WhatsApp has independent enabled state stored in Twilio config
      return (await getWhatsAppConfig()).enabled;
    default:
      return false;
  }
}

/**
 * Get WhatsApp configuration (stored in Twilio provider config)
 */
export async function getWhatsAppConfig(): Promise<SMSConfig> {
  try {
    const twilioProvider = await prisma.notificationProvider.findUnique({
      where: { provider: 'twilio' },
    });

    if (twilioProvider && twilioProvider.config) {
      const config = await getDecryptedConfig('twilio', twilioProvider.config);

      // Prioritize specific WhatsApp credentials, fall back to global Twilio credentials
      const accountSid = (config.whatsappAccountSid || config.accountSid) as string | undefined;
      const authToken = (config.whatsappAuthToken || config.authToken) as string | undefined;

      // Check if WhatsApp is enabled (independent of Twilio SMS)
      const whatsappEnabled = config.whatsappEnabled !== undefined ? config.whatsappEnabled : true;
      if (
        whatsappEnabled &&
        accountSid &&
        authToken &&
        config.whatsappNumber &&
        config.whatsappContentSid
      ) {
        return {
          enabled: true,
          provider: 'twilio',
          accountSid,
          authToken,
          fromNumber: config.fromNumber as string | undefined,
          whatsappNumber: config.whatsappNumber as string,
          whatsappContentSid: config.whatsappContentSid as string,
        };
      }
    }
  } catch (error) {
    logger.error('Failed to load WhatsApp config from database', {
      component: 'notification-providers',
      error,
    });
  }

  return {
    enabled: false,
    provider: null,
  };
}

/**
 * Get SMS configuration from database only
 */
export async function getSMSConfig(): Promise<SMSConfig> {
  try {
    const twilioProvider = await prisma.notificationProvider.findUnique({
      where: { provider: 'twilio' },
    });

    if (twilioProvider && twilioProvider.enabled && twilioProvider.config) {
      const config = await getDecryptedConfig('twilio', twilioProvider.config);
      if (config.accountSid && config.authToken) {
        return {
          enabled: true,
          provider: 'twilio',
          accountSid: config.accountSid as string,
          authToken: config.authToken as string,
          fromNumber: config.fromNumber as string | undefined,
          whatsappNumber: config.whatsappNumber as string | undefined,
          whatsappContentSid: config.whatsappContentSid as string | undefined,
        };
      }
    }

    const awsProvider = await prisma.notificationProvider.findUnique({
      where: { provider: 'aws-sns' },
    });

    if (awsProvider && awsProvider.enabled && awsProvider.config) {
      const config = await getDecryptedConfig('aws-sns', awsProvider.config);
      if (config.accessKeyId && config.secretAccessKey) {
        return {
          enabled: true,
          provider: 'aws-sns',
          region: (config.region as string) || 'us-east-1',
          accessKeyId: config.accessKeyId as string,
          secretAccessKey: config.secretAccessKey as string,
        };
      }
    }
  } catch (error) {
    logger.error('Failed to load SMS config from database', {
      component: 'notification-providers',
      error,
    });
  }

  return {
    enabled: false,
    provider: null,
  };
}

/**
 * Get Push notification configuration from database only
 */
export async function getPushConfig(): Promise<PushConfig> {
  try {
    const webPushProvider = await prisma.notificationProvider.findUnique({
      where: { provider: 'web-push' },
    });

    if (webPushProvider && webPushProvider.enabled && webPushProvider.config) {
      const config = await getDecryptedConfig('web-push', webPushProvider.config);
      if (config.vapidPublicKey && config.vapidPrivateKey) {
        return {
          enabled: true,
          provider: 'web-push',
          vapidPublicKey: config.vapidPublicKey as string,
          vapidPrivateKey: config.vapidPrivateKey as string,
          vapidSubject: config.vapidSubject as string | undefined,
          vapidKeyHistory: Array.isArray(config.vapidKeyHistory)
            ? (config.vapidKeyHistory as Array<{ publicKey: string; privateKey: string }>)
            : [],
        };
      }
    }
  } catch (error) {
    logger.error('Failed to load Push config from database', {
      component: 'notification-providers',
      error,
    });
  }

  return {
    enabled: false,
    provider: null,
  };
}
