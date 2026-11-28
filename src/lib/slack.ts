/**
 * Slack Integration
 * Supports both webhook and Slack API methods for sending notifications.
 * Includes interactive buttons for ack/resolve actions.
 */

import prisma from './prisma';
import { logger } from './logger';
import { readSlackWebhookUrl } from './slack-webhook-secret';
import { getBaseUrl } from './env-validation';
import { retryFetch, isRetryableHttpError } from './retry';
import { readSlackBotToken } from '@/app/api/slack/oauth/token-rotation';
import { isRetryableSlackTransportError } from './slack/api';
import { buildIncidentCard } from './slack/incident-card';
import {
  deliverLiveIncidentCard,
  postSlackChannelMessage,
  type SlackInstall,
  type SlackLiveCardRequest,
} from './slack/live-card';

export type SlackEventType = 'triggered' | 'acknowledged' | 'resolved';

interface IncidentDetails {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  assigneeName?: string;
  /** Optional richer fields; queued payloads carry createdAt as an ISO string. */
  priority?: string | null;
  description?: string | null;
  createdAt?: string | Date | null;
}

function cardIncident(incident: IncidentDetails) {
  const createdAt = incident.createdAt ? new Date(incident.createdAt) : null;
  return {
    ...incident,
    createdAt: createdAt && Number.isFinite(createdAt.getTime()) ? createdAt : null,
  };
}

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN; // Bot token for Slack API (fallback)

/** Returns the configured global webhook only when it is a non-empty value. */
export function configuredSlackWebhookUrl(): string | undefined {
  return SLACK_WEBHOOK_URL?.trim() || undefined;
}

export type SlackDeliveryResult = {
  success: boolean;
  error?: string;
  errorCode?: string;
  statusCode?: number;
  retryAfterMs?: number;
  /** Delivered without sending anything (e.g. an edit-only request with no card to edit). */
  skipped?: boolean;
  /** Slack message timestamp and conversation ID of the posted or edited bot message. */
  ts?: string;
  channel?: string;
  /** True when an existing live card was edited instead of a new message posted. */
  updated?: boolean;
};

function slackRetryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  const deadline = new Date(value).getTime();
  return Number.isFinite(deadline) ? Math.max(1_000, deadline - Date.now()) : undefined;
}

function slackFailure(errorCode: string, response: Response): SlackDeliveryResult {
  // Slack reports this workspace-wide free-plan usage cap as an API error,
  // rather than an HTTP 429. Waiting seconds and retrying cannot clear it.
  const rateLimited =
    errorCode === 'rate_limited' || errorCode === 'ratelimited' || response.status === 429;
  return {
    success: false,
    error: errorCode,
    errorCode,
    statusCode: rateLimited ? 429 : response.status,
    retryAfterMs: rateLimited ? slackRetryAfterMs(response) : undefined,
  };
}

/**
 * The Slack install whose token delivers for this service: the service's own enabled integration,
 * then the oldest enabled global one (deterministic when several exist), then SLACK_BOT_TOKEN.
 */
const installInFlight = new Map<string, Promise<SlackInstall | null>>();

async function resolveSlackInstall(serviceId?: string): Promise<SlackInstall | null> {
  if (serviceId) {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        slackIntegration: true,
      },
    });
    const own = service?.slackIntegration;
    if (own?.enabled && own.botToken) {
      try {
        return {
          // Refreshes a rotating token shortly before it expires; plain decrypt otherwise.
          token: await readSlackBotToken(own),
          scopes: own.scopes ?? [],
          workspaceId: own.workspaceId ?? null,
        };
      } catch (error) {
        logger.error('[Slack] Failed to decrypt token', { serviceId, error });
      }
    }
  }

  // Global integration (one not linked to any service); oldest first so the choice is stable.
  const globalIntegration = await prisma.slackIntegration.findFirst({
    where: {
      enabled: true,
      services: { none: {} },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (globalIntegration?.botToken) {
    try {
      return {
        token: await readSlackBotToken(globalIntegration),
        scopes: globalIntegration.scopes ?? [],
        workspaceId: globalIntegration.workspaceId ?? null,
      };
    } catch (error) {
      logger.error('[Slack] Failed to decrypt global token', { error });
    }
  }

  // Environment token: OpsKnight never saw its scopes, so optional features stay off.
  return SLACK_BOT_TOKEN ? { token: SLACK_BOT_TOKEN, scopes: [], workspaceId: null } : null;
}

/** Coalesces concurrent lookups so multi-channel fan-out does not spike the database. */
export function getSlackInstall(serviceId?: string): Promise<SlackInstall | null> {
  const cacheKey = serviceId || '__global__';
  const inFlight = installInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = resolveSlackInstall(serviceId).finally(() => {
    installInFlight.delete(cacheKey);
  });

  installInFlight.set(cacheKey, promise);
  return promise;
}

/**
 * Get Slack bot token for a service (from OAuth integration or env fallback)
 * Coalesces concurrent in-flight lookups to eliminate database query spikes during multi-channel fan-out.
 */
export async function getSlackBotToken(serviceId?: string): Promise<string | null> {
  return (await getSlackInstall(serviceId))?.token ?? null;
}

/**
 * Bot scopes granted to the installation whose token getSlackBotToken returns for this service (same
 * precedence: the service's own integration, then the global one). Empty for the environment-variable
 * token, whose scopes OpsKnight never saw.
 */
export async function getSlackBotScopes(serviceId?: string): Promise<string[]> {
  if (serviceId) {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { slackIntegration: { select: { enabled: true, botToken: true, scopes: true } } },
    });
    const own = service?.slackIntegration;
    if (own?.enabled && own.botToken) return own.scopes;
  }
  const global = await prisma.slackIntegration.findFirst({
    where: { enabled: true, services: { none: {} } },
    select: { botToken: true, scopes: true },
    orderBy: { createdAt: 'asc' },
  });
  return global?.botToken ? global.scopes : [];
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
  const targetUrl = webhookUrl?.trim() || configuredSlackWebhookUrl();

  if (!targetUrl) {
    logger.warn(
      '[Slack] No webhook URL configured (global or service-level), skipping notification'
    );
    return { success: false, error: 'No Slack webhook URL configured' };
  }

  // Incoming webhooks cannot edit what they posted, so each event is a fresh card without buttons.
  const payload = buildIncidentCard(cardIncident(incident), {
    appUrl: getBaseUrl(),
    interactive: false,
    eventType,
    note: additionalMessage,
  });

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
        // 429 is not retried in-process: retryAfterMs goes back to the queue, which defers the job.
        retryableErrors: error =>
          isRetryableSlackTransportError(error) &&
          (error as { statusCode?: number }).statusCode !== 429,
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

    const responseText = typeof response.text === 'function' ? await response.text() : 'ok';
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
    await readSlackWebhookUrl(incident.service.slackWebhookUrl)
  ); // Pass service-level webhook (stored encrypted)
}

/**
 * Send message to Slack channel via Slack API (not webhook)
 *
 * With `options.card` (service channel notifications) the incident keeps one live card per channel:
 * later events edit it in place and reply in its thread. Without it (SLA notices, automation posts)
 * every call posts a new message, as before.
 */
export async function sendSlackMessageToChannel(
  channel: string,
  incident: IncidentDetails,
  eventType: SlackEventType,
  includeInteractiveButtons: boolean = true,
  serviceId?: string,
  additionalMessage?: string,
  options: { maxAttempts?: number; card?: SlackLiveCardRequest } = {}
): Promise<SlackDeliveryResult> {
  const normalizedChannel = channel.trim();
  if (!normalizedChannel) {
    return { success: false, error: 'Slack channel is required', errorCode: 'CHANNEL_REQUIRED' };
  }
  // Get bot token (from OAuth integration or env fallback)
  const install = await getSlackInstall(serviceId);

  if (!install) {
    logger.warn('[Slack] No bot token configured for channel delivery', {
      channel: normalizedChannel,
      serviceId,
    });
    return {
      success: false,
      error: 'No Slack bot token configured for channel delivery',
      errorCode: 'SLACK_BOT_TOKEN_MISSING',
    };
  }

  // Use ID directly if it looks like an ID (C/G/D/U...), otherwise ensure # prefix for names
  const postChannel = /^[CGDU][A-Z0-9]+$/.test(normalizedChannel)
    ? normalizedChannel
    : normalizedChannel.startsWith('#')
      ? normalizedChannel
      : `#${normalizedChannel}`;
  const maxAttempts = options.maxAttempts ?? 3;

  try {
    const result = options.card
      ? await deliverLiveIncidentCard({
          install,
          incidentId: incident.id,
          channel: normalizedChannel,
          postChannel,
          request: options.card,
          interactive: includeInteractiveButtons,
          note: additionalMessage,
          maxAttempts,
        })
      : await (async (): Promise<SlackDeliveryResult> => {
          const card = buildIncidentCard(cardIncident(incident), {
            appUrl: getBaseUrl(),
            interactive: includeInteractiveButtons,
            eventType,
            note: additionalMessage,
          });
          const posted = await postSlackChannelMessage(
            install,
            postChannel,
            { text: card.text, blocks: card.blocks, attachments: card.attachments },
            maxAttempts
          );
          if (posted.ok) return { success: true, ts: posted.data.ts, channel: posted.data.channel };
          const rateLimited = posted.status === 429 || posted.error === 'ratelimited';
          return {
            success: false,
            error: posted.error,
            errorCode: posted.error,
            statusCode: rateLimited ? 429 : posted.status,
            retryAfterMs: rateLimited ? posted.retryAfterMs : undefined,
          };
        })();

    if (!result.success) {
      logger.error('[Slack] API call failed', { error: result.error, channel: normalizedChannel });
      return result;
    }
    logger.info('[Slack] Channel incident message delivered', {
      channel: normalizedChannel,
      eventType: options.card?.event ?? eventType,
      incidentId: incident.id,
      updated: result.updated,
      skipped: result.skipped,
    });
    return result;
  } catch (error: unknown) {
    const err = error as { message?: string; statusCode?: number; retryAfterMs?: number };
    logger.error('[Slack] API error', { error: err.message, channel: normalizedChannel });
    return {
      success: false,
      error: err.message || 'Slack API error',
      statusCode: err.statusCode,
      retryAfterMs: err.retryAfterMs,
    };
  }
}

function slackChannelParam(channel: string): string {
  const value = channel.trim();
  return /^[CGDU][A-Z0-9]+$/.test(value) || value.startsWith('#') ? value : `#${value}`;
}

/** Posts a non-incident message (text + blocks) with the global bot token. Single attempt by default. */
export async function sendSlackChannelText(
  channel: string,
  body: { text: string; blocks?: unknown[] },
  options: { maxAttempts?: number } = {}
): Promise<SlackDeliveryResult> {
  if (!channel.trim())
    return { success: false, error: 'Slack channel is required', errorCode: 'CHANNEL_REQUIRED' };
  const botToken = await getSlackBotToken();
  if (!botToken)
    return {
      success: false,
      error: 'No Slack bot token configured for channel delivery',
      errorCode: 'SLACK_BOT_TOKEN_MISSING',
    };
  try {
    const response = await retryFetch(
      'https://slack.com/api/chat.postMessage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botToken}` },
        body: JSON.stringify({ channel: slackChannelParam(channel), ...body }),
      },
      { maxAttempts: options.maxAttempts ?? 1, initialDelayMs: 1000 }
    );
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok)
      return slackFailure(data.error || `HTTP ${response.status}`, response);
    return { success: true };
  } catch (error: unknown) {
    const err = error as { message?: string; statusCode?: number; retryAfterMs?: number };
    return {
      success: false,
      error: err.message || 'Slack API error',
      statusCode: err.statusCode,
      retryAfterMs: err.retryAfterMs,
    };
  }
}

/**
 * Whether the connected workspace's bot can see this channel id. Null when it cannot be checked
 * (no bot token, Slack unreachable): callers keep the value as free text then.
 */
export async function slackChannelExists(channelId: string): Promise<boolean | null> {
  const botToken = await getSlackBotToken();
  if (!botToken) return null;
  try {
    const response = await fetch(
      `https://slack.com/api/conversations.info?channel=${encodeURIComponent(channelId)}`,
      { headers: { Authorization: `Bearer ${botToken}` }, signal: AbortSignal.timeout(5_000) }
    );
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (data.ok) return true;
    return data.error === 'channel_not_found' ? false : null;
  } catch {
    return null;
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
