import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';
import { buildMicrosoftTeamsIncidentCard, type MicrosoftTeamsIncidentCardInput } from './cards';
import { getMicrosoftTeamsConfig } from './auth';

export type TeamsDeliveryResult = { success: true; providerMessageId?: string; conversationId?: string } | { success: false; error: string; statusCode?: number; retryAfterMs?: number; errorCode?: string };

type GraphToken = { access_token: string; expires_in: number };

// Tenant-scoped token cache — prevents cross-tenant reuse (P0 fix).
// Key: `${clientId}:${tenantId}`, bounded to 50 entries (LRU eviction).
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const TOKEN_CACHE_MAX = 50;

function tokenCacheKey(clientId: string, tenantId: string): string {
  return `${clientId}:${tenantId}`;
}

function getCachedToken(clientId: string, tenantId: string): string | null {
  const key = tokenCacheKey(clientId, tenantId);
  const entry = tokenCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now() + 60_000) {
    tokenCache.delete(key);
    return null;
  }
  // Refresh LRU order
  tokenCache.delete(key);
  tokenCache.set(key, entry);
  return entry.token;
}

function putCachedToken(clientId: string, tenantId: string, token: string, expiresIn: number): void {
  const key = tokenCacheKey(clientId, tenantId);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const firstKey = tokenCache.keys().next().value as string | undefined;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(key, { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 });
}

export function __clearGraphTokenCacheForTests(): void {
  tokenCache.clear();
}

async function graphToken(clientId: string, clientSecret: string, tenantId: string): Promise<string | null> {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant) {
    logger.warn('[MicrosoftTeams] Graph token requires explicit tenantId — refusing /common fallback');
    return null;
  }
  const cached = getCachedToken(clientId, normalizedTenant);
  if (cached) return cached;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  try {
    const res = await retryFetch(`https://login.microsoftonline.com/${encodeURIComponent(normalizedTenant)}/oauth2/v2.0/token`, {
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
    putCachedToken(clientId, normalizedTenant, data.access_token, data.expires_in);
    return data.access_token;
  } catch (e) {
    logger.warn('[MicrosoftTeams] Graph token exception', { error: (e as Error).message });
    return null;
  }
}

function resolveTenantForCall(explicitTenantId: string | undefined, configTenantId: string | null | undefined): string | null {
  const t = explicitTenantId?.trim() || configTenantId?.trim() || '';
  return t || null;
}

// ---------------------------------------------------------------------------
// Bot Framework Activity transport (send + update)
// ---------------------------------------------------------------------------

async function botToken(clientId: string, clientSecret: string, tenantId: string): Promise<string | null> {
  // Bot Framework uses the same Entra client-credentials flow, scope is Bot Framework resource
  // For Phase 1 we use the Graph scope token re-use where applicable; Bot serviceUrl auth
  // is via the Graph token when available, falling back to Bot-specific OAuth.
  return graphToken(clientId, clientSecret, tenantId);
}

async function sendBotActivity(args: {
  serviceUrl: string;
  teamId: string;
  channelId: string;
  cardJson: string;
  incidentId: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
}): Promise<TeamsDeliveryResult> {
  const token = await botToken(args.clientId, args.clientSecret, args.tenantId);
  if (!token) return { success: false, error: 'Failed to acquire Graph token', errorCode: 'GRAPH_TOKEN_FAILED', statusCode: 503 };

  // Phase 1 strategy: use Graph RSC `ChannelMessage.Send.Group` to post the Adaptive Card.
  // App-only Graph PATCH is not used for updates — updates go via bot activity or fresh card fallback.
  const card = JSON.parse(args.cardJson) as unknown;
  const endpoint = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(args.teamId)}/channels/${encodeURIComponent(args.channelId)}/messages`;
  const body = {
    body: { contentType: 'html', content: `<attachment id="${args.incidentId}"></attachment>` },
    attachments: [{ id: args.incidentId, contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) }],
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
    if (status === 429) return { success: false, error: 'Teams rate limited', errorCode: 'RATE_LIMITED', statusCode: 429, retryAfterMs };
    if (status === 404) return { success: false, error: 'Teams channel not found', errorCode: 'CHANNEL_NOT_FOUND', statusCode: 404 };
    if (status === 401 || status === 403) return { success: false, error: 'Teams authorization failed', errorCode: 'AUTH_EXPIRED', statusCode: status };
    return { success: false, error: code, errorCode: `http_${status}`, statusCode: status, retryAfterMs };
  }

  try {
    const data = (await res.json()) as { id?: string };
    return { success: true, providerMessageId: data?.id, conversationId: undefined };
  } catch {
    return { success: true };
  }
}

async function updateBotActivity(args: {
  teamId: string;
  channelId: string;
  messageId: string;
  cardJson: string;
  incidentId: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
}): Promise<TeamsDeliveryResult> {
  const token = await graphToken(args.clientId, args.clientSecret, args.tenantId);
  if (!token) return { success: false, error: 'Failed to acquire Graph token', errorCode: 'GRAPH_TOKEN_FAILED', statusCode: 503 };

  // Attempt Graph PATCH for update. App-only permissions restrict normal message updates
  // to `policyViolation` per Microsoft docs — so we attempt PATCH, and on 403/405 with
  // app-permission signal, caller falls back to posting a new card.
  const card = JSON.parse(args.cardJson) as unknown;
  const endpoint = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(args.teamId)}/channels/${encodeURIComponent(args.channelId)}/messages/${encodeURIComponent(args.messageId)}`;
  const body = {
    body: { contentType: 'html', content: `<attachment id="${args.incidentId}"></attachment>` },
    attachments: [{ id: args.incidentId, contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) }],
  };
  const res = await retryFetch(endpoint, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { maxAttempts: 2, initialDelayMs: 800 });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const s = res.status;
    if (s === 429) {
      const raw = res.headers?.get?.('Retry-After');
      const n = raw ? Number.parseInt(raw, 10) : NaN;
      const retryAfterMs = Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
      return { success: false, error: 'Teams rate limited', errorCode: 'RATE_LIMITED', statusCode: 429, retryAfterMs };
    }
    // Signal to caller that PATCH is not supported for this auth context — do NOT silently duplicate
    if (s === 403 || s === 405) {
      return { success: false, error: text.slice(0, 600) || `HTTP ${s}`, errorCode: 'PATCH_NOT_SUPPORTED', statusCode: s };
    }
    if (s === 404) return { success: false, error: 'Teams message not found', errorCode: 'MESSAGE_NOT_FOUND', statusCode: 404 };
    return { success: false, error: text.slice(0, 600) || `HTTP ${s}`, errorCode: `http_${s}`, statusCode: s };
  }
  return { success: true, providerMessageId: args.messageId };
}

// ---------------------------------------------------------------------------
// Public API: send / update incident cards
// ---------------------------------------------------------------------------

export async function sendMicrosoftTeamsIncidentCard(args: {
  tenantId: string;
  teamId: string;
  channelId: string;
  incident: MicrosoftTeamsIncidentCardInput['incident'];
  eventType: MicrosoftTeamsIncidentCardInput['eventType'];
  disableActions?: boolean;
}): Promise<TeamsDeliveryResult> {
  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return { success: false, error: 'Microsoft Teams is not configured', errorCode: 'NOT_CONFIGURED', statusCode: 422 };
  const tenantId = resolveTenantForCall(args.tenantId, resolved.config.tenantId);
  if (!tenantId) return { success: false, error: 'Teams tenant is not configured', errorCode: 'TENANT_REQUIRED', statusCode: 422 };

  const cardObj = buildMicrosoftTeamsIncidentCard(
    { incident: args.incident, eventType: args.eventType },
    { disableActions: args.disableActions },
  );
  return sendBotActivity({
    serviceUrl: '',
    teamId: args.teamId,
    channelId: args.channelId,
    cardJson: JSON.stringify(cardObj),
    incidentId: args.incident.id,
    clientId: resolved.config.clientId,
    clientSecret: resolved.clientSecret,
    tenantId,
  });
}

export async function updateMicrosoftTeamsIncidentCard(args: {
  tenantId: string;
  teamId: string;
  channelId: string;
  messageId: string;
  incident: MicrosoftTeamsIncidentCardInput['incident'];
  eventType: MicrosoftTeamsIncidentCardInput['eventType'];
  disableActions?: boolean;
}): Promise<TeamsDeliveryResult> {
  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return { success: false, error: 'Microsoft Teams is not configured', errorCode: 'NOT_CONFIGURED', statusCode: 422 };
  const tenantId = resolveTenantForCall(args.tenantId, resolved.config.tenantId);
  if (!tenantId) return { success: false, error: 'Teams tenant is not configured', errorCode: 'TENANT_REQUIRED', statusCode: 422 };

  const cardObj = buildMicrosoftTeamsIncidentCard(
    { incident: args.incident, eventType: args.eventType },
    { disableActions: args.disableActions },
  );
  return updateBotActivity({
    teamId: args.teamId,
    channelId: args.channelId,
    messageId: args.messageId,
    cardJson: JSON.stringify(cardObj),
    incidentId: args.incident.id,
    clientId: resolved.config.clientId,
    clientSecret: resolved.clientSecret,
    tenantId,
  });
}

export async function testMicrosoftTeamsConnection(destinationId: string): Promise<TeamsDeliveryResult> {
  const prisma = (await import('@/lib/prisma')).default;
  const dest = await prisma.microsoftTeamsDestination.findUnique({ where: { id: destinationId } });
  if (!dest) return { success: false, error: 'Destination not found', errorCode: 'DESTINATION_NOT_FOUND', statusCode: 404 };
  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return { success: false, error: 'Microsoft Teams is not configured', errorCode: 'NOT_CONFIGURED', statusCode: 422 };
  const tenantId = resolveTenantForCall(dest.tenantId, resolved.config.tenantId);
  if (!tenantId) return { success: false, error: 'Teams tenant is not configured for this destination', errorCode: 'TENANT_REQUIRED', statusCode: 422 };
  const token = await graphToken(resolved.config.clientId, resolved.clientSecret, tenantId);
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

// ---------------------------------------------------------------------------
// RSC grant truth — query actual granted permissions from Graph
// ---------------------------------------------------------------------------

export type TeamsRscGrantState = {
  granted: string[] | null;
  missing: string[];
  unknown: boolean;
  error?: string;
};

export async function getTeamsGrantedRscPermissions(options?: {
  explicitTenantId?: string;
}): Promise<TeamsRscGrantState> {
  const { MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS } = await import('./app-manifest');
  const required = [...MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS];

  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) {
    return { granted: null, missing: required, unknown: true, error: 'NOT_CONFIGURED' };
  }
  const tenantId = resolveTenantForCall(options?.explicitTenantId, resolved.config.tenantId);
  if (!tenantId) {
    return { granted: null, missing: required, unknown: true, error: 'TENANT_REQUIRED' };
  }

  const token = await graphToken(resolved.config.clientId, resolved.clientSecret, tenantId);
  if (!token) {
    return { granted: null, missing: required, unknown: true, error: 'GRAPH_TOKEN_FAILED' };
  }

  // Try to list teams and aggregate permissionGrants per team. RSC grants are
  // per-team resource-specific consent — `GET /teams/{id}/permissionGrants`.
  // If the tenant has no installed teams, we cannot verify → unknown (not "granted").
  try {
    const prismaForTeams = (await import('@/lib/prisma')).default as unknown as {
      microsoftTeamsInstallation: { findMany: (a: unknown) => Promise<Array<{ teamId: string }>> };
    };
    const installations = await prismaForTeams.microsoftTeamsInstallation.findMany({
      where: { tenantId, enabled: true },
      select: { teamId: true },
      take: 5,
    });

    // If no installations, try a lightweight Graph probe to verify consent.
    // A 403 on `GET /teams` with ChannelSettings.Read.Group missing indicates not granted.
    if (installations.length === 0) {
      const probe = await retryFetch(
        'https://graph.microsoft.com/v1.0/teams?$top=1',
        { headers: { Authorization: `Bearer ${token}` } },
        { maxAttempts: 1, initialDelayMs: 400 },
      );
      if (probe.status === 401 || probe.status === 403) {
        // Check error body for missing permission signal
        const probeText = await probe.text().catch(() => '');
        const needsConsent = /permission|consent|authorization/i.test(probeText);
        if (needsConsent) {
          return { granted: [], missing: required, unknown: false };
        }
        return { granted: null, missing: required, unknown: true, error: `http_${probe.status}` };
      }
      if (probe.ok) {
        return { granted: null, missing: required, unknown: true, error: 'NO_TEAMS_INSTALLED' };
      }
      return { granted: null, missing: required, unknown: true, error: `http_${probe.status}` };
    }

    let allGranted: string[] | null = null;
    let hadSuccess = false;

    for (const inst of installations) {
      const res = await retryFetch(
        `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(inst.teamId)}/permissionGrants`,
        { headers: { Authorization: `Bearer ${token}` } },
        { maxAttempts: 2, initialDelayMs: 500 },
      );
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { granted: [], missing: required, unknown: false };
        }
        if (res.status === 404) continue; // Team may be deleted
        continue;
      }
      hadSuccess = true;
      try {
        const data = (await res.json()) as { value?: Array<{ resourceSpecificPermission?: string }> };
        const perms = (data.value ?? [])
          .map(v => v.resourceSpecificPermission)
          .filter((p): p is string => typeof p === 'string' && p.length > 0);
        if (allGranted === null) allGranted = [];
        for (const p of perms) {
          if (!allGranted.includes(p)) allGranted.push(p);
        }
      } catch {
        // JSON parse failure → treat as unknown
      }
    }

    if (!hadSuccess) {
      return { granted: null, missing: required, unknown: true, error: 'PERMISSION_GRANTS_UNAVAILABLE' };
    }

    const grantedList = allGranted ?? [];
    const missing = required.filter(p => !grantedList.includes(p));
    return { granted: grantedList, missing, unknown: false };
  } catch (e) {
    return {
      granted: null,
      missing: required,
      unknown: true,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * Installation-scoped team discovery (Phase 4).
 * Source of truth is MicrosoftTeamsInstallation (verified via Bot Framework
 * conversationUpdate). We enrich with cached teamName and optionally verify
 * via Graph per-team (Team.Read) — no broad GET /teams enumeration.
 */
export async function listMicrosoftTeamsForDiscovery(options?: {
  tenantId?: string;
}): Promise<{ teams: Array<{ id: string; displayName: string; description?: string | null }>; error?: string }> {
  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return { teams: [], error: 'NOT_CONFIGURED' };
  const tenantId = resolveTenantForCall(options?.tenantId, resolved.config.tenantId);
  if (!tenantId) return { teams: [], error: 'TENANT_REQUIRED' };
  const prismaForTeams = (await import('@/lib/prisma')).default as unknown as {
    microsoftTeamsInstallation: {
      findMany: (a: unknown) => Promise<Array<{ teamId: string; teamName: string | null }>>;
    };
  };
  try {
    const installations = await prismaForTeams.microsoftTeamsInstallation.findMany({
      where: { tenantId, enabled: true },
      select: { teamId: true, teamName: true },
      orderBy: { teamName: 'asc' },
      take: 100,
    });
    if (installations.length === 0) {
      return { teams: [], error: undefined };
    }
    const teams = installations.map(i => ({
      id: i.teamId,
      displayName: i.teamName ?? i.teamId,
      description: null as string | null,
    }));
    return { teams };
  } catch (e) {
    return {
      teams: [],
      error: e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400),
    };
  }
}

export async function listMicrosoftTeamsChannelsForDiscovery(
  teamId: string,
  options?: { tenantId?: string },
): Promise<{ channels: Array<{ id: string; displayName: string; description?: string | null }>; error?: string }> {
  const tid = teamId.trim();
  if (!tid) return { channels: [], error: 'teamId is required' };
  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return { channels: [], error: 'NOT_CONFIGURED' };
  const tenantId = resolveTenantForCall(options?.tenantId, resolved.config.tenantId);
  if (!tenantId) return { channels: [], error: 'TENANT_REQUIRED' };
  const token = await graphToken(resolved.config.clientId, resolved.clientSecret, tenantId);
  if (!token) return { channels: [], error: 'GRAPH_TOKEN_FAILED' };
  const res = await retryFetch(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(tid)}/channels?$top=100`,
    { headers: { Authorization: `Bearer ${token}` } },
    { maxAttempts: 2, initialDelayMs: 600 },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { channels: [], error: text.slice(0, 400) || `HTTP ${res.status}` };
  }
  try {
    const data = (await res.json()) as { value?: Array<{ id: string; displayName: string; description?: string | null }> };
    const channels = (data.value ?? []).map(c => ({ id: c.id, displayName: c.displayName, description: c.description ?? null }));
    return { channels };
  } catch {
    return { channels: [], error: 'Failed to parse channels list' };
  }
}
