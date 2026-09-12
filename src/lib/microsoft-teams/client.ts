import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';
import { buildMicrosoftTeamsIncidentCard, type MicrosoftTeamsIncidentCardInput } from './cards';
import { getMicrosoftTeamsConfig } from './auth';

export type TeamsDeliveryResult = { success: true; providerMessageId?: string; conversationId?: string } | { success: false; error: string; statusCode?: number; retryAfterMs?: number; errorCode?: string };

type GraphToken = { access_token: string; expires_in: number };

let cachedToken: { token: string; expiresAt: number } | null = null;

async function graphToken(clientId: string, clientSecret: string, tenantId?: string | null): Promise<string | null> {
  const tenant = tenantId?.trim() || 'common';
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  try {
    const res = await retryFetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }, { maxAttempts: 2, initialDelayMs: 800 });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('[MicrosoftTeams] Graph token failed', { status: res.status, body: text.slice(0, 400) });
      return null;
    }
    const data = (await res.json()) as GraphToken;
    cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in - 60) * 1000 };
    return data.access_token;
  } catch (e) {
    logger.warn('[MicrosoftTeams] Graph token exception', { error: (e as Error).message });
    return null;
  }
}

/**
 * Phase 1: post an Adaptive Card to a Teams channel via Graph.
 *
 * Uses `POST /teams/{teamId}/channels/{channelId}/messages` with an
 * `attachments` payload that carries the Adaptive Card JSON. The Graph
 * resource requires `ChannelMessage.Send.Group` (RSC) and an app-only token.
 *
 * Reliability: retryFetch handles transient 5xx; 429 surfaces `retryAfterMs`
 * so the notification control plane can defer provider admission.
 */
export async function sendMicrosoftTeamsIncidentCard(args: {
  tenantId: string;
  teamId: string;
  channelId: string;
  incident: MicrosoftTeamsIncidentCardInput['incident'];
  eventType: MicrosoftTeamsIncidentCardInput['eventType'];
}): Promise<TeamsDeliveryResult> {
  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return { success: false, error: 'Microsoft Teams is not configured', errorCode: 'NOT_CONFIGURED', statusCode: 422 };
  const token = await graphToken(resolved.config.clientId, resolved.clientSecret, args.tenantId || resolved.config.tenantId || undefined);
  if (!token) return { success: false, error: 'Failed to acquire Graph token', errorCode: 'GRAPH_TOKEN_FAILED', statusCode: 503 };

  const card = buildMicrosoftTeamsIncidentCard({ incident: args.incident, eventType: args.eventType });
  const endpoint = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(args.teamId)}/channels/${encodeURIComponent(args.channelId)}/messages`;
  const body = {
    body: { contentType: 'html', content: `<attachment id="${args.incident.id}"></attachment>` },
    attachments: [{ id: args.incident.id, contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) }],
  };

  const res = await retryFetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { maxAttempts: 2, initialDelayMs: 800 });

  const retryAfterMs = (() => {
    const v = res.headers?.get?.('Retry-After');
    if (!v) return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
  })();

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const code = text.slice(0, 600) || `HTTP ${res.status}`;
    const status = res.status;
    if (status === 429) return { success: false, error: 'Teams rate limited', errorCode: 'rate_limited', statusCode: 429, retryAfterMs };
    if (status === 404) return { success: false, error: 'Teams channel not found', errorCode: 'CHANNEL_NOT_FOUND', statusCode: 404 };
    if (status === 401 || status === 403) return { success: false, error: 'Teams authorization failed', errorCode: 'not_authed', statusCode: status };
    return { success: false, error: code, errorCode: `http_${status}`, statusCode: status, retryAfterMs };
  }

  try {
    const data = (await res.json()) as { id?: string };
    return { success: true, providerMessageId: data?.id, conversationId: undefined };
  } catch {
    return { success: true };
  }
}

export async function updateMicrosoftTeamsIncidentCard(args: {
  tenantId: string;
  teamId: string;
  channelId: string;
  messageId: string;
  incident: MicrosoftTeamsIncidentCardInput['incident'];
  eventType: MicrosoftTeamsIncidentCardInput['eventType'];
}): Promise<TeamsDeliveryResult> {
  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return { success: false, error: 'Microsoft Teams is not configured', errorCode: 'NOT_CONFIGURED', statusCode: 422 };
  const token = await graphToken(resolved.config.clientId, resolved.clientSecret, args.tenantId || resolved.config.tenantId || undefined);
  if (!token) return { success: false, error: 'Failed to acquire Graph token', errorCode: 'GRAPH_TOKEN_FAILED', statusCode: 503 };
  const card = buildMicrosoftTeamsIncidentCard({ incident: args.incident, eventType: args.eventType });
  const endpoint = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(args.teamId)}/channels/${encodeURIComponent(args.channelId)}/messages/${encodeURIComponent(args.messageId)}`;
  const body = {
    body: { contentType: 'html', content: `<attachment id="${args.incident.id}"></attachment>` },
    attachments: [{ id: args.incident.id, contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) }],
  };
  const res = await retryFetch(endpoint, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { maxAttempts: 2, initialDelayMs: 800 });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const s = res.status;
    if (s === 429) return { success: false, error: 'Teams rate limited', errorCode: 'rate_limited', statusCode: 429 };
    return { success: false, error: text.slice(0, 600) || `HTTP ${s}`, errorCode: `http_${s}`, statusCode: s };
  }
  return { success: true, providerMessageId: args.messageId };
}

export async function testMicrosoftTeamsConnection(destinationId: string): Promise<TeamsDeliveryResult> {
  const prisma = (await import('@/lib/prisma')).default;
  const dest = await prisma.microsoftTeamsDestination.findUnique({ where: { id: destinationId } });
  if (!dest) return { success: false, error: 'Destination not found', errorCode: 'DESTINATION_NOT_FOUND', statusCode: 404 };
  // Lightweight Graph probe: try to read the channel. Does not post a message.
  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return { success: false, error: 'Microsoft Teams is not configured', errorCode: 'NOT_CONFIGURED', statusCode: 422 };
  const token = await graphToken(resolved.config.clientId, resolved.clientSecret, dest.tenantId || resolved.config.tenantId || undefined);
  if (!token) return { success: false, error: 'Failed to acquire Graph token', errorCode: 'GRAPH_TOKEN_FAILED', statusCode: 503 };
  const res = await retryFetch(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(dest.teamId)}/channels/${encodeURIComponent(dest.channelId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    { maxAttempts: 2, initialDelayMs: 600 },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { success: false, error: text.slice(0, 600) || `HTTP ${res.status}`, statusCode: res.status };
  }
  return { success: true };
}
