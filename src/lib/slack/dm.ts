/**
 * Slack DM paging: a responder who picked "Slack DM" gets the incident as a direct message.
 *
 * Runs inside the central notification plane (circuit breaker, provider admission and the durable
 * retry schedule live there), so each call here makes exactly one attempt and reports a result the
 * plane can classify: 429 carries Retry-After, other 4xx are permanent, 5xx and network errors retry.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/env-validation';
import { getSlackBotScopes, getSlackBotToken } from '@/lib/slack';
import { slackDmEligibility } from './health';
import { buildSlackDmIncidentMessage, type SlackDmEventType } from './incident-dm-card';

export type SlackDmResult = {
  success: boolean;
  skipped?: boolean;
  error?: string;
  errorCode?: string;
  statusCode?: number;
  retryAfterMs?: number;
  providerMessageId?: string;
};

const SLACK_TIMEOUT_MS = 10_000;
const SLACK_USER_CACHE_TTL_MS = 60 * 60 * 1000;
const slackUserCache = new Map<string, { id: string; expiresAt: number }>();

/** Test seam. */
export function resetSlackDmCache(): void {
  slackUserCache.clear();
}

/** Admin-level availability: Slack is connected with the scopes DM paging needs. */
export async function isSlackDmAvailable(): Promise<boolean> {
  try {
    return slackDmEligibility(await getSlackBotScopes()).eligible;
  } catch {
    return false;
  }
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

type SlackCall = { ok: true; data: Record<string, unknown> } | { ok: false; result: SlackDmResult };

async function callSlack(
  method: string,
  token: string,
  body: Record<string, unknown>,
  form = false
): Promise<SlackCall> {
  let response: Response;
  try {
    response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': form
          ? 'application/x-www-form-urlencoded'
          : 'application/json; charset=utf-8',
      },
      body: form
        ? new URLSearchParams(body as Record<string, string>).toString()
        : JSON.stringify(body),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      result: {
        success: false,
        errorCode: timedOut ? 'ETIMEDOUT' : 'ECONNRESET',
        error: `Slack ${method} network error: ${timedOut ? 'timed out' : 'fetch failed'}`,
      },
    };
  }
  if (response.status === 429) {
    return {
      ok: false,
      result: {
        success: false,
        statusCode: 429,
        errorCode: 'ratelimited',
        error: `Slack ${method} rate limited`,
        retryAfterMs: retryAfterMs(response),
      },
    };
  }
  if (response.status >= 500) {
    return {
      ok: false,
      result: {
        success: false,
        statusCode: response.status,
        error: `Slack ${method} temporarily unavailable (HTTP ${response.status})`,
      },
    };
  }
  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      result: { success: false, statusCode: 502, error: `Slack ${method} returned invalid JSON` },
    };
  }
  if (data.ok) return { ok: true, data };
  const code = typeof data.error === 'string' ? data.error : 'unknown_error';
  if (code === 'ratelimited' || code === 'rate_limited') {
    return {
      ok: false,
      result: {
        success: false,
        statusCode: 429,
        errorCode: code,
        error: `Slack ${method}: ${code}`,
      },
    };
  }
  if (code === 'internal_error' || code === 'service_unavailable' || code === 'fatal_error') {
    return {
      ok: false,
      result: {
        success: false,
        statusCode: 503,
        errorCode: code,
        error: `Slack ${method}: ${code}`,
      },
    };
  }
  // Everything else (users_not_found, missing_scope, invalid_auth, ...) will not fix itself on retry.
  return {
    ok: false,
    result: { success: false, statusCode: 400, errorCode: code, error: `Slack ${method}: ${code}` },
  };
}

async function slackUserIdForEmail(
  token: string,
  email: string
): Promise<SlackCall & { id?: string }> {
  const key = email.trim().toLowerCase();
  const cached = slackUserCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ok: true, data: {}, id: cached.id };
  const call = await callSlack('users.lookupByEmail', token, { email: key }, true);
  if (!call.ok) return call;
  const user = (call.data.user ?? {}) as Record<string, unknown>;
  const profile = (user.profile ?? {}) as Record<string, unknown>;
  // Only DM a real, active member whose Slack email is confirmed.
  if (
    typeof user.id !== 'string' ||
    user.deleted ||
    user.is_bot ||
    profile.is_email_confirmed === false
  ) {
    return {
      ok: false,
      result: {
        success: false,
        statusCode: 404,
        errorCode: 'users_not_found',
        error: 'No active Slack member with a confirmed matching email',
      },
    };
  }
  slackUserCache.set(key, { id: user.id, expiresAt: Date.now() + SLACK_USER_CACHE_TTL_MS });
  return { ok: true, data: call.data, id: user.id };
}

function incidentUrl(incidentId: string): string {
  let base = 'http://localhost:3000';
  try {
    base = getBaseUrl().replace(/\/+$/, '');
  } catch {
    // Fall back to localhost so the card still renders; the link is the only casualty.
  }
  return `${base}/incidents/${encodeURIComponent(incidentId)}`;
}

export async function sendSlackIncidentDm(input: {
  userId: string;
  incidentId: string;
  eventType: SlackDmEventType;
}): Promise<SlackDmResult> {
  const [scopes, token] = await Promise.all([getSlackBotScopes(), getSlackBotToken()]);
  const eligibility = slackDmEligibility(scopes);
  if (!token || !eligibility.eligible) {
    return {
      success: false,
      statusCode: 422,
      errorCode: 'not_configured',
      error: 'Slack DM paging is not configured (connect Slack with im:write and users:read.email)',
    };
  }

  const [user, incident] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { email: true, status: true } }),
    prisma.incident.findUnique({
      where: { id: input.incidentId },
      select: {
        id: true,
        title: true,
        status: true,
        urgency: true,
        priority: true,
        createdAt: true,
        service: { select: { name: true } },
        assignee: { select: { name: true, email: true } },
      },
    }),
  ]);
  if (!user || user.status !== 'ACTIVE' || !user.email) {
    return { success: true, skipped: true, error: 'Recipient has no active account email' };
  }
  if (!incident) {
    return {
      success: false,
      statusCode: 404,
      errorCode: 'incident_not_found',
      error: 'Incident not found',
    };
  }

  const lookup = await slackUserIdForEmail(token, user.email);
  if (!lookup.ok) {
    if (lookup.result.errorCode === 'users_not_found') {
      logger.info('[Slack DM] No Slack member for recipient', { userId: input.userId });
    }
    return lookup.result;
  }

  const opened = await callSlack('conversations.open', token, { users: lookup.id });
  if (!opened.ok) return opened.result;
  const channelId = ((opened.data.channel ?? {}) as Record<string, unknown>).id;
  if (typeof channelId !== 'string') {
    return {
      success: false,
      statusCode: 502,
      error: 'Slack conversations.open returned no channel',
    };
  }

  const message = buildSlackDmIncidentMessage(
    {
      id: incident.id,
      title: incident.title,
      serviceName: incident.service?.name ?? 'Unknown service',
      status: incident.status,
      urgency: incident.urgency,
      priority: incident.priority,
      createdAt: incident.createdAt,
      assigneeName: incident.assignee?.name || incident.assignee?.email || null,
      url: incidentUrl(incident.id),
    },
    input.eventType
  );

  const posted = await callSlack('chat.postMessage', token, {
    channel: channelId,
    text: message.text,
    blocks: message.blocks,
    unfurl_links: false,
  });
  if (!posted.ok) return posted.result;
  return {
    success: true,
    providerMessageId: typeof posted.data.ts === 'string' ? posted.data.ts : undefined,
  };
}
