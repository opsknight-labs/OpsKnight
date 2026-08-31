/**
 * SMS Notification Service
 * Sends SMS notifications for incidents
 *
 * SMS providers are configured via the UI at Settings → System → Notification Providers
 *
 * To use with Twilio (recommended):
 * 1. Install: npm install twilio
 * 2. Configure Twilio in Settings → System → Notification Providers
 *
 * To use with AWS SNS:
 * 1. Install: npm install @aws-sdk/client-sns
 * 2. Set AWS credentials in .env
 * 3. Use AWS SNS implementation
 */

import prisma from './prisma';
import { getSMSConfig } from './notification-providers';
import { getBaseUrl } from './env-validation';
import { logger } from './logger';
import { decodeNotificationEnvelope } from './notification-payload';

export type SMSOptions = {
  to: string; // Phone number in E.164 format (e.g., +1234567890)
  message: string;
  notificationId?: string;
};

type TwilioClient = {
  messages: {
    create: (params: {
      body: string;
      from: string;
      to: string;
      statusCallback?: string;
    }) => Promise<{ sid: string; status: string }>;
  };
};

type TwilioFactory = (accountSid: string, authToken: string) => TwilioClient;

type AwsSnsModule = {
  SNSClient: new (config: {
    region: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
  }) => { send: (command: unknown) => Promise<{ MessageId?: string }> };
  PublishCommand: new (input: { PhoneNumber: string; Message: string }) => unknown;
};

export function formatToE164(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';
  let cleaned = phone
    .replace(/^whatsapp:/i, '')
    .replace(/(?:ext\.?|extension|x)\s*\d+\s*$/i, '')
    .trim();
  if (!cleaned) return '';
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2).trimStart()}`;
  // International numbers are often written as +44 (0) 7911..., where
  // `(0)` documents the domestic trunk prefix and is not part of E.164.
  // Only remove the explicitly marked trunk prefix; guessing from a bare
  // zero would corrupt countries where a leading zero is significant.
  cleaned = cleaned.replace(/^(\+\s*\d{1,3})\s*\(0\)\s*/, '$1');
  // Country-less national numbers are ambiguous and must be rejected,
  // rather than silently routed through NANP or another guessed country.
  if (!cleaned.startsWith('+')) return '';
  const digits = cleaned.slice(1).replace(/[\s().-]/g, '');
  if (!/^\d{7,15}$/.test(digits) || digits.startsWith('0')) return '';
  return `+${digits}`;
}

/**
 * Send SMS notification
 * Uses structured logger for delivery events and warnings
 */
export async function sendSMS(options: SMSOptions): Promise<{
  success: boolean;
  error?: string;
  messageSid?: string;
  statusCode?: number;
  errorCode?: string;
  retryAfterMs?: number;
}> {
  try {
    // Get SMS configuration
    const smsConfig = await getSMSConfig();

    // Check if SMS is enabled
    if (!smsConfig.enabled) {
      logger.warn('SMS notification disabled', {
        to: options.to,
        message: options.message.substring(0, 100),
        provider: smsConfig.provider,
      });
      return { success: false, error: 'SMS notifications are not enabled' };
    }

    // Format phone number to E.164 and validate minimal digit count
    const toNumber = formatToE164(options.to);
    const digitsOnly = toNumber.replace(/\D/g, '');
    if (!toNumber || digitsOnly.length < 7 || digitsOnly.length > 15) {
      return { success: false, error: 'Invalid phone number format' };
    }

    // Use configured provider
    if (smsConfig.provider === 'twilio') {
      // Load Twilio dynamically
      let twilio: TwilioFactory | null = null;
      try {
        const twilioModule = await import('twilio');
        twilio = (twilioModule.default || twilioModule) as unknown as TwilioFactory;
        if (!twilio) {
          throw new Error('Twilio package not installed');
        }
      } catch (_error: unknown) {
        logger.warn('Twilio package not installed', {
          component: 'sms',
          provider: 'twilio',
          installCommand: 'npm install twilio',
        });
        return {
          success: false,
          error: 'Twilio package not installed. Install it with: npm install twilio',
        };
      }

      // Validate required Twilio config
      if (!smsConfig.accountSid || !smsConfig.authToken || !smsConfig.fromNumber) {
        return {
          success: false,
          error:
            'Twilio configuration incomplete. Please configure Account SID, Auth Token, and From Number in Settings → System → Notification Providers',
        };
      }

      try {
        const client = twilio(smsConfig.accountSid, smsConfig.authToken);

        // Format phone number to E.164
        const toNumber = formatToE164(options.to);

        logger.info('Sending SMS via Twilio', {
          to: toNumber,
          from: smsConfig.fromNumber,
          messageLength: options.message.length,
        });

        const result = await client.messages.create({
          body: options.message,
          from: smsConfig.fromNumber,
          to: toNumber,
          ...(options.notificationId
            ? {
                statusCallback: `${getBaseUrl()}/api/webhooks/notifications/twilio?notificationId=${encodeURIComponent(options.notificationId)}`,
              }
            : {}),
        });

        logger.info('SMS sent successfully via Twilio', {
          to: toNumber,
          from: smsConfig.fromNumber,
          messageSid: result.sid,
          status: result.status,
        });

        return { success: true, messageSid: result.sid };
      } catch (error: unknown) {
        const errorInfo =
          error && typeof error === 'object'
            ? (error as { message?: string; code?: string | number; status?: number })
            : {};
        logger.error('Twilio SMS send error', {
          component: 'sms',
          provider: 'twilio',
          error: { message: errorInfo.message, code: errorInfo.code, status: errorInfo.status },
          to: options.to,
          from: smsConfig.fromNumber,
        });

        // Provide user-friendly error messages for common Twilio errors
        let errorMessage =
          errorInfo.message || `Twilio error: ${errorInfo.code || 'Unknown error'}`;

        // Handle unverified number error (common with trial accounts)
        if (errorInfo.code === 21211 || errorInfo.message?.includes('unverified')) {
          errorMessage = `Phone number ${options.to} is not verified in your Twilio account. Trial accounts can only send to verified numbers. Please verify the number at https://twilio.com/user/account/phone-numbers/verified or upgrade your Twilio account.`;
        }

        // Handle invalid phone number format
        if (errorInfo.code === 21211 || errorInfo.message?.includes('Invalid')) {
          errorMessage = `Invalid phone number format: ${options.to}. Please ensure the number is in E.164 format (e.g., +1234567890) and is verified in your Twilio account.`;
        }

        // Handle authentication errors
        if (errorInfo.code === 20003 || errorInfo.status === 401) {
          errorMessage =
            'Twilio authentication failed. Please check your Account SID and Auth Token in Settings → System → Notification Providers.';
        }

        // Handle insufficient balance
        if (errorInfo.code === 21212 || errorInfo.message?.includes('insufficient')) {
          errorMessage =
            'Twilio account has insufficient balance. Please add funds to your Twilio account.';
        }

        // Handle "From" number mismatch (Error 21660)
        if (errorInfo.code === 21660) {
          errorMessage = `Configuration Error: The 'From' number ${smsConfig.fromNumber} is not a valid SMS-capable number in your Twilio account. It might be a WhatsApp-only number. Please update your configuration in Settings → System with a valid Twilio SMS phone number.`;
        }

        return {
          success: false,
          error: errorMessage,
          statusCode:
            errorInfo.status === 429 || String(errorInfo.code) === '20429' ? 429 : errorInfo.status,
          errorCode: errorInfo.code == null ? undefined : String(errorInfo.code),
          retryAfterMs:
            errorInfo.status === 429 || String(errorInfo.code) === '20429' ? 60_000 : undefined,
        };
      }
    }

    if (smsConfig.provider === 'aws-sns') {
      try {
        // Validate required AWS SNS config
        if (!smsConfig.accessKeyId || !smsConfig.secretAccessKey) {
          return {
            success: false,
            error:
              'AWS SNS configuration incomplete. Please configure Access Key ID and Secret Access Key in Settings → System → Notification Providers',
          };
        }

        // Format phone number to E.164
        const toNumber = formatToE164(options.to);

        // Load AWS SNS dynamically (optional dependency)
        let SNSClient: AwsSnsModule['SNSClient'];
        let PublishCommand: AwsSnsModule['PublishCommand'];
        try {
          const loadAwsSns = () => {
            try {
              return require('@aws-sdk/client-sns'); // eslint-disable-line @typescript-eslint/no-require-imports
            } catch {
              return null;
            }
          };
          const awsSns = loadAwsSns();
          if (!awsSns) {
            throw new Error('AWS SDK not installed');
          }
          SNSClient = awsSns.SNSClient;
          PublishCommand = awsSns.PublishCommand;
        } catch {
          logger.warn('AWS SDK package not installed', {
            component: 'sms',
            provider: 'aws-sns',
            installCommand: 'npm install @aws-sdk/client-sns',
          });
          return {
            success: false,
            error: 'AWS SDK package not installed. Install with: npm install @aws-sdk/client-sns',
          };
        }

        const client = new SNSClient({
          region: smsConfig.region || 'us-east-1',
          credentials: {
            accessKeyId: smsConfig.accessKeyId,
            secretAccessKey: smsConfig.secretAccessKey,
          },
        });

        logger.info('Sending SMS via AWS SNS', {
          to: toNumber,
          region: smsConfig.region || 'us-east-1',
          messageLength: options.message.length,
        });

        const command = new PublishCommand({
          PhoneNumber: toNumber,
          Message: options.message,
        });

        const result = await client.send(command);
        logger.info('SMS sent successfully via AWS SNS', {
          to: toNumber,
          messageId: result.MessageId,
        });
        return { success: true };
      } catch (error: unknown) {
        const errorInfo =
          error && typeof error === 'object'
            ? (error as { code?: string; message?: string; name?: string })
            : {};

        logger.error('AWS SNS SMS send error', {
          component: 'sms',
          provider: 'aws-sns',
          error: { message: errorInfo.message, code: errorInfo.code, name: errorInfo.name },
          to: options.to,
        });

        // Provide user-friendly error messages for common AWS errors
        let errorMessage = errorInfo.message || 'AWS SNS error';

        // Handle authentication errors
        if (
          errorInfo.name === 'InvalidClientTokenId' ||
          errorInfo.name === 'UnrecognizedClientException'
        ) {
          errorMessage =
            'AWS authentication failed. Please check your Access Key ID and Secret Access Key in Settings → System → Notification Providers.';
        }

        // Handle invalid parameter errors
        if (errorInfo.name === 'InvalidParameterValue') {
          errorMessage = `Invalid phone number format: ${options.to}. Please ensure the number is in E.164 format (e.g., +1234567890).`;
        }

        // Handle opt-out (user blocked SMS)
        if (errorInfo.code === 'OptedOut') {
          errorMessage = `Phone number ${options.to} has opted out of receiving SMS messages.`;
        }

        // Handle spending limit exceeded
        if (errorInfo.code === 'Throttling') {
          errorMessage =
            'AWS SNS spending limit reached. Please check your AWS SNS spending quota.';
        }

        const throttled =
          errorInfo.code === 'Throttling' || errorInfo.name === 'ThrottlingException';
        return {
          success: false,
          error: errorMessage,
          statusCode: throttled ? 429 : undefined,
          errorCode: errorInfo.code || errorInfo.name,
          retryAfterMs: throttled ? 60_000 : undefined,
        };
      }
    }

    // No provider configured
    return { success: false, error: 'No SMS provider configured' };
  } catch (error: unknown) {
    const errorInfo = error && typeof error === 'object' ? (error as { message?: string }) : {};
    logger.error('SMS send error', { component: 'sms', error, to: options.to });
    return { success: false, error: errorInfo.message || 'SMS send error' };
  }
}

/**
 * Send incident notification SMS
 */
export async function sendIncidentSMS(
  userId: string,
  incidentId: string,
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated',
  notificationId?: string,
  durableMessage?: string
): Promise<{ success: boolean; error?: string; messageSid?: string }> {
  try {
    const [user, incident] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.incident.findUnique({
        where: { id: incidentId },
        include: {
          service: true,
          assignee: true,
        },
      }),
    ]);

    if (!user || !incident) {
      return { success: false, error: 'User or incident not found' };
    }

    if (!user.phoneNumber) {
      return { success: false, error: 'User has no phone number configured' };
    }

    const envelope = decodeNotificationEnvelope(durableMessage);
    const notificationIncident = envelope
      ? {
          title: envelope.snapshot.title,
          urgency: envelope.snapshot.urgency,
          service: { name: envelope.snapshot.service.name },
        }
      : incident;
    const baseUrl = getBaseUrl();
    const incidentUrl = `${baseUrl}/incidents/${incidentId}`;

    // Emojis and labels based on event type and urgency
    const eventEmoji =
      notificationIncident.urgency === 'HIGH'
        ? eventType === 'triggered'
          ? '🚨'
          : eventType === 'acknowledged'
            ? '⚠️'
            : '✅'
        : notificationIncident.urgency === 'MEDIUM'
          ? eventType === 'triggered'
            ? '⚠️'
            : eventType === 'acknowledged'
              ? 'ℹ️'
              : '✅'
          : eventType === 'triggered'
            ? 'ℹ️'
            : eventType === 'acknowledged'
              ? 'ℹ️'
              : '✅';

    const _statusLabel =
      eventType === 'resolved'
        ? 'RESOLVED'
        : eventType === 'acknowledged'
          ? 'ACK'
          : notificationIncident.urgency === 'HIGH'
            ? 'CRITICAL'
            : notificationIncident.urgency === 'MEDIUM'
              ? 'ELEVATED'
              : 'INCIDENT';

    // Build professional OpsKnight branded message (optimized for SMS)
    const titleMaxLength = 35;
    const serviceMaxLength = 15;

    const title =
      notificationIncident.title.length > titleMaxLength
        ? notificationIncident.title.substring(0, titleMaxLength - 1) + '…'
        : notificationIncident.title;

    const service =
      notificationIncident.service.name.length > serviceMaxLength
        ? notificationIncident.service.name.substring(0, serviceMaxLength - 1) + '…'
        : notificationIncident.service.name;

    // Professional OpsKnight SMS format with clean structure:
    // Line 1: [OpsKnight] STATUS
    // Line 2: Incident Title
    // Line 3: Service Name
    // Line 4: Link
    const message =
      eventType === 'resolved'
        ? `[OpsKnight] ${eventEmoji} Resolved: ${title}\n✓ ${service}\n${incidentUrl}`
        : eventType === 'acknowledged'
          ? `[OpsKnight] ${eventEmoji} Acknowledged: ${title}\n⚡ ${service}\n${incidentUrl}`
          : eventType === 'updated'
            ? `[OpsKnight] ${eventEmoji} Updated: ${title}\nℹ ${service}\n${incidentUrl}`
            : `[OpsKnight] ${eventEmoji} ${
                notificationIncident.urgency === 'HIGH'
                  ? 'CRITICAL'
                  : notificationIncident.urgency === 'MEDIUM'
                    ? 'Elevated'
                    : 'Incident'
              }: ${title}\n⚠ ${service}\n${incidentUrl}`;

    // Format phone number to E.164 format if needed
    let phoneNumber = user.phoneNumber.trim();
    if (!phoneNumber.startsWith('+')) {
      // If no country code, assume it's already formatted or add default
      // For now, just use as-is and let Twilio handle validation
      logger.warn('Phone number missing country code', { phoneNumber });
    } else {
      // Ensure it's properly formatted (remove spaces, dashes, etc.)
      phoneNumber = phoneNumber.replace(/[\s\-\(\)]/g, '');
    }

    return await sendSMS({
      to: phoneNumber,
      message,
      notificationId,
    });
  } catch (error: unknown) {
    const errorInfo = error && typeof error === 'object' ? (error as { message?: string }) : {};
    logger.error('Send incident SMS error', {
      component: 'sms',
      error,
      incidentId,
      userId,
      eventType,
    });
    return { success: false, error: errorInfo.message || 'Send incident SMS error' };
  }
}
