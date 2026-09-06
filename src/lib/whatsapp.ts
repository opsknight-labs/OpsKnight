/**
 * WhatsApp Integration via Twilio
 * Sends WhatsApp notifications for incidents
 */

import prisma from './prisma';
import { logger } from './logger';
import { getBaseUrl } from './env-validation';
import { getWhatsAppConfig } from './notification-providers';
import { formatToE164 } from './sms';
import { decodeNotificationEnvelope } from './notification-payload';

export type WhatsAppOptions = {
  userId: string;
  incidentId: string;
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated';
};

const normalizeWhatsAppNumber = (value: string) => formatToE164(value.replace(/^whatsapp:/i, ''));

/**
 * Send WhatsApp notification for an incident
 * Uses Twilio WhatsApp API (format: whatsapp:+1234567890)
 */
export async function sendIncidentWhatsApp(
  userId: string,
  incidentId: string,
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated',
  notificationId?: string,
  durableMessage?: string
): Promise<{ success: boolean; error?: string; messageSid?: string }> {
  try {
    // Get user and incident
    const [user, incident] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { phoneNumber: true, name: true },
      }),
      prisma.incident.findUnique({
        where: { id: incidentId },
        include: { service: true, assignee: true },
      }),
    ]);

    if (!user || !incident) {
      return { success: false, error: 'User or incident not found' };
    }

    if (!user.phoneNumber) {
      return { success: false, error: 'User has no phone number configured' };
    }

    // Get WhatsApp config (independent of Twilio SMS)
    const whatsappConfig = await getWhatsAppConfig();
    if (!whatsappConfig.enabled || whatsappConfig.provider !== 'twilio') {
      return { success: false, error: 'WhatsApp not configured or enabled' };
    }

    // Format phone number for WhatsApp (must be E.164 format)
    const phoneNumber = formatToE164(user.phoneNumber);
    if (!phoneNumber) {
      return { success: false, error: 'Phone number must include an international country code' };
    }
    const whatsappNumber = `whatsapp:${phoneNumber}`;
    // Get WhatsApp from number from database config
    const whatsappFromNumber = whatsappConfig.whatsappNumber;
    const normalizedFromNumber = whatsappFromNumber
      ? normalizeWhatsAppNumber(whatsappFromNumber)
      : '';
    const fromNumber = normalizedFromNumber ? `whatsapp:${normalizedFromNumber}` : null;

    if (!fromNumber) {
      return { success: false, error: 'Twilio WhatsApp number not configured' };
    }

    const envelope = decodeNotificationEnvelope(durableMessage);
    const notificationIncident = envelope
      ? {
          id: envelope.snapshot.incidentId,
          title: envelope.snapshot.title,
          urgency: envelope.snapshot.urgency,
          service: { name: envelope.snapshot.service.name },
        }
      : incident;

    // Format message
    const baseUrl = getBaseUrl();
    const incidentUrl = `${baseUrl}/incidents/${notificationIncident.id}`;

    let statusLine = '';

    if (eventType === 'triggered') {
      statusLine =
        notificationIncident.urgency === 'HIGH' ? '🚨 Critical Alert' : '⚠️ Incident Alert';
    } else if (eventType === 'acknowledged') {
      statusLine = '👀 Incident Acknowledged';
    } else if (eventType === 'resolved') {
      statusLine = '✅ Incident Resolved';
    } else {
      statusLine = 'ℹ️ Incident Updated';
    }

    // Truncate for sanity, though WhatsApp limit is 1600 chars
    const titleMaxLength = 100;
    const title =
      notificationIncident.title.length > titleMaxLength
        ? notificationIncident.title.substring(0, titleMaxLength) + '...'
        : notificationIncident.title;

    // Send via Twilio WhatsApp API
    const twilioModule = await import('twilio');
    const twilio = (twilioModule.default || twilioModule) as unknown as (
      sid?: string,
      token?: string
    ) => {
      messages: {
        create: (opts: Record<string, unknown>) => Promise<{ sid: string }>;
      };
    };
    const client = twilio(whatsappConfig.accountSid, whatsappConfig.authToken);

    try {
      let messageResult: { sid: string };

      if (whatsappConfig.whatsappContentSid) {
        // Use Twilio Content API (Templates) - Required for 24h window
        // Variables: 1: Title, 2: Service, 3: Status, 4: Link
        const cleanTitle = title
          .replace(/[\r\n\t]+/g, ' ')
          .trim()
          .slice(0, 120);
        const cleanService = (notificationIncident.service?.name || 'Service')
          .replace(/[\r\n\t]+/g, ' ')
          .trim()
          .slice(0, 80);
        const cleanStatus = statusLine
          .replace(/[\*\_]/g, '')
          .replace(/[\r\n\t]+/g, ' ')
          .trim();
        const cleanUrl = incidentUrl.replace(/[\r\n\t\s]+/g, '').trim();

        const variables = {
          '1': cleanTitle,
          '2': cleanService,
          '3': cleanStatus,
          '4': cleanUrl,
        };

        messageResult = await client.messages.create({
          from: fromNumber,
          to: whatsappNumber,
          contentSid: whatsappConfig.whatsappContentSid,
          contentVariables: JSON.stringify(variables),
          ...(notificationId
            ? {
                statusCallback: `${getBaseUrl()}/api/webhooks/notifications/twilio?notificationId=${encodeURIComponent(notificationId)}`,
              }
            : {}),
        });

        logger.info('WhatsApp notification sent via Template', {
          userId,
          incidentId,
          contentSid: whatsappConfig.whatsappContentSid,
          messageSid: messageResult.sid,
        });
      } else {
        // Fallback to plain text message within session window
        const body = `${statusLine}\n*${title}*\nService: ${notificationIncident.service?.name || 'Unknown'}\nDetails: ${incidentUrl}`;
        messageResult = await client.messages.create({
          from: fromNumber,
          to: whatsappNumber,
          body,
          ...(notificationId
            ? {
                statusCallback: `${getBaseUrl()}/api/webhooks/notifications/twilio?notificationId=${encodeURIComponent(notificationId)}`,
              }
            : {}),
        });

        logger.info('WhatsApp notification sent via Session Text', {
          userId,
          incidentId,
          messageSid: messageResult.sid,
        });
      }

      return { success: true, messageSid: messageResult.sid };
    } catch (twilioError: unknown) {
      const err = twilioError as { message?: string; code?: string | number };
      const isWindowExpired = err.code === 63016 || err.code === '63016';
      const errorMessage = isWindowExpired
        ? 'WhatsApp 24-hour session window expired (Twilio Error 63016). Ensure an approved Content Template SID is configured.'
        : err.message || 'WhatsApp send failed';

      logger.error('WhatsApp send error', {
        userId,
        incidentId,
        error: err.message,
        code: err.code,
        isWindowExpired,
      });

      return { success: false, error: errorMessage };
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('WhatsApp notification error', {
      userId,
      incidentId,
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}

/**
 * Send WhatsApp message (generic)
 */
export async function sendWhatsApp(
  to: string,
  message: string,
  from?: string,
  notificationId?: string
): Promise<{
  success: boolean;
  error?: string;
  messageSid?: string;
  statusCode?: number;
  errorCode?: string;
  retryAfterMs?: number;
}> {
  try {
    const whatsappConfig = await getWhatsAppConfig();
    if (!whatsappConfig.enabled || whatsappConfig.provider !== 'twilio') {
      return { success: false, error: 'WhatsApp not configured or enabled' };
    }

    // Format phone numbers
    const toNumber = formatToE164(to);
    if (!toNumber) {
      return { success: false, error: 'Phone number must include an international country code' };
    }
    const whatsappTo = `whatsapp:${toNumber}`;
    // Get WhatsApp from number from database config
    const whatsappFromNumber = whatsappConfig.whatsappNumber;
    const normalizedFrom = from
      ? normalizeWhatsAppNumber(from)
      : whatsappFromNumber
        ? normalizeWhatsAppNumber(whatsappFromNumber)
        : '';
    const whatsappFrom = normalizedFrom ? `whatsapp:${normalizedFrom}` : null;

    if (!whatsappFrom) {
      return { success: false, error: 'WhatsApp from number not configured' };
    }

    // Send via Twilio WhatsApp API
    const twilioModule = await import('twilio');
    const twilio = (twilioModule.default || twilioModule) as unknown as (
      sid?: string,
      token?: string
    ) => {
      messages: {
        create: (opts: Record<string, unknown>) => Promise<{ sid: string }>;
      };
    };

    const client = twilio(whatsappConfig.accountSid, whatsappConfig.authToken);

    const messageResult = await client.messages.create({
      from: whatsappFrom,
      to: whatsappTo,
      body: message,
      ...(notificationId
        ? {
            statusCallback: `${getBaseUrl()}/api/webhooks/notifications/twilio?notificationId=${encodeURIComponent(notificationId)}`,
          }
        : {}),
    });

    return { success: true, messageSid: messageResult.sid };
  } catch (error: unknown) {
    const err: Error & { status?: number; code?: string | number } =
      error && typeof error === 'object'
        ? (error as Error & { status?: number; code?: string | number })
        : new Error(String(error));
    logger.error('WhatsApp send error', {
      to,
      error: err.message,
    });
    const rateLimited = err.status === 429 || String(err.code) === '20429';
    return {
      success: false,
      error: err.message,
      statusCode: rateLimited ? 429 : err.status,
      errorCode: err.code == null ? undefined : String(err.code),
      retryAfterMs: rateLimited ? 60_000 : undefined,
    };
  }
}
