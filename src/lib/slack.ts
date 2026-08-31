/**
 * Slack Integration
 * Supports both webhook and Slack API methods for sending notifications.
 * Includes interactive buttons for ack/resolve actions.
 */

import prisma from './prisma';
import { logger } from './logger';
import { getBaseUrl } from './env-validation';
import { retryFetch, isRetryableHttpError } from './retry';
import { decrypt } from './encryption';

export type SlackEventType = 'triggered' | 'acknowledged' | 'resolved';

interface IncidentDetails {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  assigneeName?: string;
}

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN; // Bot token for Slack API (fallback)

const STATUS_COLORS = new Map<SlackEventType, string>([
  ['triggered', '#d32f2f'], // Red for new incidents
  ['acknowledged', '#f9a825'], // Amber for acknowledged
  ['resolved', '#388e3c'], // Green for resolved
]);

const STATUS_EMOJI = new Map<SlackEventType, string>([
  ['triggered', ':rotating_light:'],
  ['acknowledged', ':warning:'],
  ['resolved', ':white_check_mark:'],
]);

const getStatusColor = (eventType: SlackEventType) => STATUS_COLORS.get(eventType) ?? '#757575';
const getStatusEmoji = (eventType: SlackEventType) =>
  STATUS_EMOJI.get(eventType) ?? ':information_source:';

export type SlackDeliveryResult = {
  success: boolean;
  error?: string;
  errorCode?: string;
  statusCode?: number;
  retryAfterMs?: number;
};

function slackRetryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  const deadline = new Date(value).getTime();
  return Number.isFinite(deadline) ? Math.max(1_000, deadline - Date.now()) : undefined;
}

function slackFailure(
  errorCode: string,
  response: Response
): SlackDeliveryResult {
  // Slack reports this workspace-wide free-plan usage cap as an API error,
  // rather than an HTTP 429. Waiting seconds and retrying cannot clear it.
  const rateLimited = errorCode === 'rate_limited' || response.status === 429;
  return {
    success: false,
    error: errorCode,
    errorCode,
    statusCode: rateLimited ? 429 : response.status,
    retryAfterMs: rateLimited ? slackRetryAfterMs(response) : undefined,
  };
}

/**
 * Get Slack bot token for a service (from OAuth integration or env fallback)
 */
export async function getSlackBotToken(serviceId?: string): Promise<string | null> {
  // Try to get from service-specific integration first
  if (serviceId) {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        slackIntegration: true,
      },
    });

    if (service?.slackIntegration?.enabled && service.slackIntegration.botToken) {
      // Decrypt token
      try {
        return await decrypt(service.slackIntegration.botToken);
      } catch (error) {
        logger.error('[Slack] Failed to decrypt token', { serviceId, error });
      }
    }
  }

  // Try global integration (one not linked to any service)
  const globalIntegration = await prisma.slackIntegration.findFirst({
    where: {
      enabled: true,
      services: { none: {} }, // Not linked to any service
    },
  });

  if (globalIntegration?.botToken) {
    try {
      return await decrypt(globalIntegration.botToken);
    } catch (error) {
      logger.error('[Slack] Failed to decrypt global token', { error });
    }
  }

  // Fallback to environment variable
  return SLACK_BOT_TOKEN || null;
}

/**
 * Send a Slack webhook notification for incident events
 */
export async function sendSlackNotification(
  eventType: SlackEventType,
  incident: IncidentDetails,
  additionalMessage?: string,
  webhookUrl?: string | null,
  options: { maxAttempts?: number } = {}
): Promise<SlackDeliveryResult> {
  const targetUrl = webhookUrl || SLACK_WEBHOOK_URL;

  if (!targetUrl) {
    logger.warn(
      '[Slack] No webhook URL configured (global or service-level), skipping notification'
    );
    return { success: false, error: 'No Slack webhook URL configured' };
  }

  const color = getStatusColor(eventType);

  const blocks = buildSlackBlocks(incident, eventType, additionalMessage, false); // No interactive buttons in webhook mode

  const payload = {
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };

  try {
    const parsedTarget = new URL(targetUrl);
    if (
      parsedTarget.protocol !== 'https:' ||
      parsedTarget.username ||
      parsedTarget.password ||
      !['hooks.slack.com', 'hooks.slack-gov.com'].includes(parsedTarget.hostname.toLowerCase())
    ) {
      return { success: false, error: 'Slack webhook URL must use an official Slack host' };
    }
    // Use retry logic for improved reliability
    const response = await retryFetch(
      targetUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'manual',
      },
      {
        maxAttempts: options.maxAttempts ?? 3,
        initialDelayMs: 1000,
        retryableErrors: error => {
          // Only retry on network errors or 5xx server errors
          if (error instanceof Error) {
            return (
              error.message.includes('fetch') ||
              error.message.includes('network') ||
              error.message.includes('timeout') ||
              error.message.includes('5')
            );
          }
          return false;
        },
      }
    );

    // Check for non-retryable errors (4xx client errors)
    if (!response.ok && !isRetryableHttpError(response.status)) {
      const errorText = await response.text();
      logger.error('[Slack] Webhook client error', {
        component: 'slack',
        statusCode: response.status,
        error: errorText,
        incident: incident.id,
      });
      return slackFailure(errorText.trim() || `HTTP ${response.status}`, response);
    }

    if (!response.ok) {
      // This shouldn't happen after retries, but handle gracefully
      const errorText = await response.text();
      logger.error('[Slack] Webhook failed after retries', {
        component: 'slack',
        statusCode: response.status,
        error: errorText,
        incident: incident.id,
      });
      return slackFailure(errorText.trim() || `HTTP ${response.status}`, response);
    }

    const responseText =
      typeof response.text === 'function' ? await response.text() : 'ok';
    if (responseText.trim() !== 'ok') return slackFailure(responseText.trim(), response);

    logger.info(
      `[Slack] Notification sent via ${webhookUrl ? 'Service' : 'Global'} Webhook: ${eventType} - ${incident.title}`
    );
    return { success: true };
  } catch (error: unknown) {
    const err = error as { message?: string; statusCode?: number; retryAfterMs?: number };
    logger.error('[Slack] Webhook error after retries', {
      component: 'slack',
      error: err.message,
      incident: incident.id,
    });
    return {
      success: false,
      error: err.message || 'Slack webhook error',
      statusCode: err.statusCode,
      retryAfterMs: err.retryAfterMs,
    };
  }
}

/**
 * Helper to send Slack notification for an incident from database
 */
export async function notifySlackForIncident(
  incidentId: string,
  eventType: SlackEventType,
  additionalMessage?: string
) {
  // Dynamic import to avoid circular deps
  const prisma = (await import('./prisma')).default;

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      service: true,
      assignee: true,
    },
  });

  if (!incident) {
    return { success: false, error: 'Incident not found' };
  }

  return sendSlackNotification(
    eventType,
    {
      id: incident.id,
      title: incident.title,
      status: incident.status,
      urgency: incident.urgency,
      serviceName: incident.service.name,
      assigneeName: incident.assignee?.name,
    },
    additionalMessage,
    incident.service.slackWebhookUrl
  ); // Pass service-level webhook
}

/**
 * Build Slack message blocks with interactive buttons
 */
/**
 * Build Slack message blocks with interactive buttons (Premium Design)
 */
function buildSlackBlocks(
  incident: IncidentDetails,
  eventType: SlackEventType,
  additionalMessage?: string,
  includeInteractiveButtons: boolean = true
): SlackBlock[] {
  const emoji = getStatusEmoji(eventType);
  const appUrl = getBaseUrl();
  const incidentUrl = `${appUrl}/incidents/${incident.id}`;

  // Format timestamps if not already present in details (assuming current time for event)
  const timestamp = Math.floor(Date.now() / 1000);

  // Status mapping to human-readable strings
  const statusLabels: Record<string, string> = {
    triggered: 'Triggered',
    acknowledged: 'Acknowledged',
    resolved: 'Resolved',
  };
  const eventLabel = statusLabels[eventType] || eventType.toUpperCase();

  const prefix = `${emoji} Incident ${eventLabel}: `;
  const maxTitleLen = Math.max(10, 150 - prefix.length);
  const safeTitle =
    incident.title.length > maxTitleLen
      ? incident.title.substring(0, maxTitleLen - 1) + '…'
      : incident.title;
  const headerText = `${prefix}${safeTitle}`.substring(0, 150);

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: headerText,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*OpsKnight*  |  <!date^${timestamp}^{date} at {time}|${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}>`,
        },
      ],
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Service:*\n${incident.serviceName}`,
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n${incident.status}`,
        },
        {
          type: 'mrkdwn',
          text: `*Urgency:*\n${incident.urgency}`,
        },
        {
          type: 'mrkdwn',
          text: `*Assignee:*\n${incident.assigneeName || 'Unassigned'}`,
        },
      ],
    },
  ];

  if (additionalMessage) {
    const safeNote =
      additionalMessage.length > 2900
        ? additionalMessage.substring(0, 2895) + '…'
        : additionalMessage;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Note:*\n${safeNote}`,
      },
    });
  }

  // Action Buttons
  if (includeInteractiveButtons) {
    const elements = [];

    // Ack button (only for triggered)
    if (eventType === 'triggered') {
      elements.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: '👀 Acknowledge',
          emoji: true,
        },
        style: 'primary',
        value: JSON.stringify({ action: 'ack', incidentId: incident.id }),
        action_id: 'ack_incident',
      });
    }

    // Assign to Me button (for non-resolved)
    if (eventType !== 'resolved') {
      elements.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🙋 Assign to Me',
          emoji: true,
        },
        value: JSON.stringify({ action: 'assign_me', incidentId: incident.id }),
        action_id: 'assign_me_incident',
      });
    }

    // Resolve button (only for acked or triggered)
    if (eventType !== 'resolved') {
      elements.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: '✅ Resolve',
          emoji: true,
        },
        style: eventType === 'acknowledged' ? 'primary' : undefined,
        value: JSON.stringify({ action: 'resolve', incidentId: incident.id }),
        action_id: 'resolve_incident',
      });
    }

    // View Incident Button (Always present)
    elements.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: 'View Details ↗', // Arrow for external link feel
        emoji: true,
      },
      url: incidentUrl,
    });

    blocks.push({
      type: 'divider',
    });

    blocks.push({
      type: 'actions',
      elements: elements,
    });
  } else {
    // If no interactive buttons, at least provide the View Link
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Details ↗',
            emoji: true,
          },
          url: incidentUrl,
        },
      ],
    });
  }

  return blocks;
}

/**
 * Send message to Slack channel via Slack API (not webhook)
 */
export async function sendSlackMessageToChannel(
  channel: string,
  incident: IncidentDetails,
  eventType: SlackEventType,
  includeInteractiveButtons: boolean = true,
  serviceId?: string,
  additionalMessage?: string,
  options: { maxAttempts?: number } = {}
): Promise<SlackDeliveryResult> {
  // Get bot token (from OAuth integration or env fallback)
  const botToken = await getSlackBotToken(serviceId);

  if (!botToken) {
    logger.warn('[Slack] No bot token configured, falling back to webhook');
    // Fallback to webhook if API token not available
    return sendSlackNotification(eventType, incident, additionalMessage, undefined, options);
  }

  const color = getStatusColor(eventType);
  const blocks = buildSlackBlocks(
    incident,
    eventType,
    additionalMessage,
    includeInteractiveButtons
  );

  const payload = {
    // Use ID directly if it looks like an ID (C/G/D/U...), otherwise ensure # prefix for names
    channel: /^[CGDU][A-Z0-9]+$/.test(channel)
      ? channel
      : channel.startsWith('#')
        ? channel
        : `#${channel}`,
    text: `[${eventType.toUpperCase()}] ${incident.title}`,
    blocks,
    attachments: [
      {
        color,
      },
    ],
  };

  try {
    const response = await retryFetch(
      'https://slack.com/api/chat.postMessage',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify(payload),
      },
      {
        maxAttempts: options.maxAttempts ?? 3,
        initialDelayMs: 1000,
        retryableErrors: error => {
          if (error instanceof Error) {
            return (
              error.message.includes('fetch') ||
              error.message.includes('network') ||
              error.message.includes('timeout') ||
              error.message.includes('5')
            );
          }
          return false;
        },
      }
    );

    const responseData = (await response.json()) as { ok?: boolean; error?: string };

    if (!response.ok || !responseData.ok) {
      const errorMsg = responseData.error || `HTTP ${response.status}`;
      logger.error('[Slack] API call failed', { error: errorMsg, channel });
      return slackFailure(errorMsg, response);
    }

    logger.info(
      `[Slack] Message sent to channel ${channel} via API: ${eventType} - ${incident.title}`
    );
    return { success: true };
  } catch (error: unknown) {
    const err = error as { message?: string; statusCode?: number; retryAfterMs?: number };
    logger.error('[Slack] API error', { error: err.message, channel });
    return {
      success: false,
      error: err.message || 'Slack API error',
      statusCode: err.statusCode,
      retryAfterMs: err.retryAfterMs,
    };
  }
}

/**
 * Send interactive Slack message with ack/resolve buttons
 */
export async function sendSlackInteractiveMessage(
  channel: string,
  incidentId: string,
  eventType: SlackEventType,
  serviceId?: string
): Promise<{ success: boolean; error?: string }> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      service: true,
      assignee: true,
    },
  });

  if (!incident) {
    return { success: false, error: 'Incident not found' };
  }

  const incidentDetails: IncidentDetails = {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    urgency: incident.urgency,
    serviceName: incident.service.name,
    assigneeName: incident.assignee?.name,
  };

  return sendSlackMessageToChannel(
    channel,
    incidentDetails,
    eventType,
    true,
    serviceId || incident.serviceId
  );
}
