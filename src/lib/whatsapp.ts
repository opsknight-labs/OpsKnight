/**
 * WhatsApp Integration via Twilio
 * Sends WhatsApp notifications for incidents
 */

import prisma from './prisma';
import { logger } from './logger';
import { getBaseUrl } from './env-validation';
import { getWhatsAppConfig } from './notification-providers';
import { formatToE164 } from './sms';

export type WhatsAppOptions = {
  userId: string;
  incidentId: string;
  eventType: 'triggered' | 'acknowledged' | 'resolved';
};

const normalizeWhatsAppNumber = (value: string) => formatToE164(value.replace(/^whatsapp:/i, ''));

/**
 * Send WhatsApp notification for an incident
 * Uses Twilio WhatsApp API (format: whatsapp:+1234567890)
 */
export async function sendIncidentWhatsApp(
  userId: string,
  incidentId: string,
  eventType: 'triggered' | 'acknowledged' | 'resolved'
): Promise<{ success: boolean; error?: string }> {
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

    // Format message
    const baseUrl = getBaseUrl();
    const incidentUrl = `${baseUrl}/incidents/${incident.id}`;

    let statusLine = '';

    if (eventType === 'triggered') {
      statusLine = incident.urgency === 'HIGH' ? '🚨 Critical Alert' : '⚠️ Incident Alert';
    } else if (eventType === 'acknowledged') {
      statusLine = '👀 Incident Acknowledged';
    } else if (eventType === 'resolved') {
      statusLine = '✅ Incident Resolved';
    }

    // Truncate for sanity, though WhatsApp limit is 1600 chars
    const titleMaxLength = 100;
    const title =
      incident.title.length > titleMaxLength
        ? incident.title.substring(0, titleMaxLength) + '...'
        : incident.title;

    // Send via Twilio WhatsApp API
    const twilioModule = await import('twilio');
    const twilio = ((twilioModule as any).default || twilioModule) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const client = twilio(whatsappConfig.accountSid, whatsappConfig.authToken);

    try {
      if (!whatsappConfig.whatsappContentSid) {
        return { success: false, error: 'WhatsApp template (contentSid) not configured' };
      }

      // Use Twilio Content API (Templates) - Required for 24h window
      // Variables: 1: Title, 2: Service, 3: Status, 4: Link
      const variables = {
        '1': title,
        '2': incident.service.name,
        '3': statusLine.replace(/[\*\_]/g, ''), // Remove markdown for plain text template
        '4': incidentUrl,
      };

      const messageResult = await client.messages.create({
        from: fromNumber,
        to: whatsappNumber,
        contentSid: whatsappConfig.whatsappContentSid,
        contentVariables: JSON.stringify(variables),
      });

      logger.info('WhatsApp notification sent via Template', {
        userId,
        incidentId,
        contentSid: whatsappConfig.whatsappContentSid,
        messageSid: messageResult.sid,
      });

      return { success: true };
    } catch (twilioError: unknown) {
      const err = twilioError as { message?: string; code?: string | number };
      logger.error('WhatsApp send error', {
        userId,
        incidentId,
        error: err.message,
        code: err.code,
      });

      return { success: false, error: err.message || 'WhatsApp send failed' };
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
  from?: string
): Promise<{ success: boolean; error?: string; messageSid?: string }> {
  try {
    const whatsappConfig = await getWhatsAppConfig();
    if (!whatsappConfig.enabled || whatsappConfig.provider !== 'twilio') {
      return { success: false, error: 'WhatsApp not configured or enabled' };
    }

    // Format phone numbers
    const toNumber = formatToE164(to);
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
    const twilio = ((twilioModule as any).default || twilioModule) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    const client = twilio(whatsappConfig.accountSid, whatsappConfig.authToken);

    const messageResult = await client.messages.create({
      from: whatsappFrom,
      to: whatsappTo,
      body: message,
    });

    return { success: true, messageSid: messageResult.sid };
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('WhatsApp send error', {
      to,
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}
