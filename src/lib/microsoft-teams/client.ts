import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';
import { buildMicrosoftTeamsIncidentCard, type MicrosoftTeamsIncidentCardInput } from './cards';
import { getMicrosoftTeamsConfig } from './auth';
import { normalizeTrustedMicrosoftTeamsServiceUrl } from './service-url';

export type TeamsDeliveryResult = { success: true; providerMessageId?: string; conversationId?: string } | { success: false; error: string; statusCode?: number; retryAfterMs?: number; errorCode?: string };

type GraphToken = { access_token: string; expires_in: number };

// Separate tenant-scoped caches for Graph vs Bot Connector.
// Must not reuse Graph tokens for serviceUrl calls — different `scope` / audience.
type TokenCache = Map<string, { token: string; expiresAt: number }>;
const graphTokenCache: TokenCache = new Map();
const botTokenCache: TokenCache = new Map();
const TOKEN_CACHE_MAX = 50;

function tokenCacheKey(clientId: string, tenantId: string): string {
  return `${clientId}:${tenantId}`;
}

function getCachedToken(cache: TokenCache, clientId: string, tenantId: string): string | null {
  const key = tokenCacheKey(clientId, tenantId);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now() + 60_000) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.token;
}

function putCachedToken(cache: TokenCache, clientId: string, tenantId: string, token: string, expiresIn: number): void {
  const key = tokenCacheKey(clientId, tenantId);
  if (cache.size >= TOKEN_CACHE_MAX) {
    const firstKey = cache.keys().next().value as string | undefined;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 });
}

export function __clearGraphTokenCacheForTests(): void {
  clearMicrosoftTeamsTokenCaches();
}
export function __clearBotTokenCacheForTests(): void {
  botTokenCache.clear();
}

export function clearMicrosoftTeamsTokenCaches(): void {
  graphTokenCache.clear();
  botTokenCache.clear();
}

async function acquireToken(
  cache: TokenCache,
  scope: string,
  clientId: string,
  clientSecret: string,
  tenantId: string,
  label: string
): Promise<string | null> {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant) {
    logger.warn(`[MicrosoftTeams] ${label} token requires explicit tenantId — refusing /common fallback`);
    return null;
  }
  const cached = getCachedToken(cache, clientId, normalizedTenant);
  if (cached) return cached;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope,
    grant_type: 'client_credentials',
  });
  try {
    const res = await retryFetch(
      `https://login.microsoftonline.com/${encodeURIComponent(normalizedTenant)}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
      { maxAttempts: 2, initialDelayMs: 800 }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(`[MicrosoftTeams] ${label} token failed`, { status: res.status, body: text.slice(0, 400) });
      return null;
    }
    const data = (await res.json()) as GraphToken;
    putCachedToken(cache, clientId, normalizedTenant, data.access_token, data.expires_in);
    return data.access_token;
  } catch (e) {
    logger.warn(`[MicrosoftTeams] ${label} token exception`, { error: (e as Error).message });
    return null;
  }
}

async function graphToken(clientId: string, clientSecret: string, tenantId: string): Promise<string | null> {
  return acquireToken(graphTokenCache, 'https://graph.microsoft.com/.default', clientId, clientSecret, tenantId, 'Graph');
}
async function botToken(clientId: string, clientSecret: string, tenantId: string): Promise<string | null> {
  return acquireToken(botTokenCache, 'https://api.botframework.com/.default', clientId, clientSecret, tenantId, 'Bot');
}

function resolveTenantForCall(explicitTenantId: string | undefined, configTenantId: string | null | undefined): string | null {
  const t = explicitTenantId?.trim() || configTenantId?.trim() || '';
  return t || null;
}

// ---------------------------------------------------------------------------
// Bot Framework Activity transport (send + update)
// ---------------------------------------------------------------------------

async function resolveServiceUrlForDestination(
  tenantId: string,
  teamId: string
): Promise<{ serviceUrl: string | null; conversationId: string | null; botRecipientId: string | null }> {
  try {
    const prismaForInstall = (await import('@/lib/prisma')).default as unknown as {
      microsoftTeamsInstallation: {
        findFirst: (a: unknown) => Promise<{ serviceUrl: string | null; conversationId: string | null; botRecipientId: string | null } | null>;
      };
    };
    const inst = await prismaForInstall.microsoftTeamsInstallation.findFirst({
      where: { tenantId, teamId, enabled: true },
      select: { serviceUrl: true, conversationId: true, botRecipientId: true },
    } as never);
    return { serviceUrl: inst?.serviceUrl ?? null, conversationId: inst?.conversationId ?? null, botRecipientId: inst?.botRecipientId ?? null };
  } catch {
    return { serviceUrl: null, conversationId: null, botRecipientId: null };
  }
}

async function sendBotActivity(args: {
  serviceUrl: string;
  botRecipientId?: string | null;
  teamId: string;
  channelId: string;
  cardJson: string;
  incidentId: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  beforeCreateAttempt?: () => Promise<void>;
}): Promise<TeamsDeliveryResult> {
  const normalizedServiceUrl = normalizeTrustedMicrosoftTeamsServiceUrl(args.serviceUrl);
  if (!normalizedServiceUrl) {
    return { success: false, error: 'Teams serviceUrl is not configured for this Team — bot not installed', errorCode: 'APP_NOT_INSTALLED', statusCode: 422 };
  }
  let token: string | null = null;
  try {
    token = await botToken(args.clientId, args.clientSecret, args.tenantId);
  } catch {}
  if (!token) return { success: false, error: 'Failed to acquire Bot Framework token', errorCode: 'GRAPH_TOKEN_FAILED', statusCode: 503 };

  const card = JSON.parse(args.cardJson) as unknown;

  const parseRetryAfter = (res: Response): number | undefined => {
    const v = res.headers?.get?.('Retry-After');
    if (!v) return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
  };

  // Proactive Bot Framework channel message. Per Bot Connector API:
  //   POST {serviceUrl}/v3/conversations  with ConversationParameters{ isGroup, channelData, bot, activity }
  // returns { id: conversationId, activityId: messageId, serviceUrl }.
  // The returned `id` is the bot-scoped conversationId (distinct from channelId) and must be stored
  // for later PUT /v3/conversations/{conversationId}/activities/{activityId}.
  // Reference: ConversationParameters.bot + Bot Framework Connector REST API.
  const activityPayload = {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }],
    channelData: { tenant: { id: args.tenantId } },
  };

  // Bot address for ConversationParameters.bot. Installation's botRecipientId (28:<guid>) is the
  // most accurate; fallback to clientId (Azure AD appId) which the Connector also accepts.
  const botAddressId = (args.botRecipientId ?? '').trim() || args.clientId.trim();

  const createEndpoint = `${normalizedServiceUrl}/v3/conversations`;
  const createBody: Record<string, unknown> = {
    isGroup: true,
    channelData: {
      channel: { id: args.channelId },
      team: { id: args.teamId },
      tenant: { id: args.tenantId },
    },
    bot: { id: botAddressId },
    activity: activityPayload,
  };
  let createRes: Response;
  // Do not translate local durability-hook failures into provider ambiguity:
  // no HTTP request has started until this hook succeeds.
  await args.beforeCreateAttempt?.();
  try {
    // Creating a conversation/activity is not idempotent. A retry after a lost
    // response can create a second incident card, so this call is deliberately
    // single-attempt. Unknown outcomes are reconciled by an operator, never by
    // issuing another POST.
    createRes = await fetch(createEndpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
      // Must remain comfortably shorter than the 120s canonical-card lease.
      // A timeout is an ambiguous create outcome and is never auto-replayed.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return {
      success: false,
      error: `Teams create outcome is ambiguous: ${error instanceof Error ? error.message : String(error)}`,
      errorCode: 'AMBIGUOUS_SIDE_EFFECT',
    };
  }

  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    const code = text.slice(0, 600) || `HTTP ${createRes.status}`;
    const status = createRes.status;
    const retryAfterMs = parseRetryAfter(createRes);
    if (status === 429) return { success: false, error: 'Teams rate limited', errorCode: 'RATE_LIMITED', statusCode: 429, retryAfterMs };
    if (status === 404) return { success: false, error: 'Teams channel not found', errorCode: 'CHANNEL_NOT_FOUND', statusCode: 404 };
    if (status === 401 || status === 403) return { success: false, error: 'Teams authorization failed', errorCode: 'AUTH_EXPIRED', statusCode: status };
    return { success: false, error: code, errorCode: `http_${status}`, statusCode: status, retryAfterMs };
  }

  try {
    const data = (await createRes.json()) as { id?: string; activityId?: string; conversation?: { id?: string }; serviceUrl?: string };
    // Connector: `id` = conversationId, `activityId` = activity/messageId. Some SDKs nest under `conversation`.
    const conversationId = typeof data?.id === 'string' && data.id.trim() ? data.id.trim() : typeof data?.conversation?.id === 'string' ? data.conversation.id.trim() : undefined;
    const providerMessageId = typeof data?.activityId === 'string' && data.activityId.trim() ? data.activityId.trim() : undefined;
    if (!conversationId || !providerMessageId) {
      return {
        success: false,
        error: 'Teams accepted the create request but did not return both conversationId and activityId',
        errorCode: 'AMBIGUOUS_SIDE_EFFECT',
        statusCode: createRes.status,
      };
    }
    return { success: true, providerMessageId, conversationId };
  } catch {
    return {
      success: false,
      error: 'Teams accepted the create request but returned an unreadable response',
      errorCode: 'AMBIGUOUS_SIDE_EFFECT',
      statusCode: createRes.status,
    };
  }
}

async function updateBotActivity(args: {
  teamId: string;
  channelId: string;
  messageId: string;
  conversationId?: string | null;
  serviceUrl?: string | null;
  cardJson: string;
  incidentId: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
}): Promise<TeamsDeliveryResult> {
  const rawServiceUrl = (args.serviceUrl ?? '').trim();
  let serviceUrl = rawServiceUrl ? normalizeTrustedMicrosoftTeamsServiceUrl(rawServiceUrl) ?? '' : '';
  if (!serviceUrl) {
    const resolved = await resolveServiceUrlForDestination(args.tenantId, args.teamId);
    serviceUrl = resolved.serviceUrl ? normalizeTrustedMicrosoftTeamsServiceUrl(resolved.serviceUrl) ?? '' : '';
  }
  if (!serviceUrl) {
    return { success: false, error: 'Teams serviceUrl is not configured — cannot update card', errorCode: 'APP_NOT_INSTALLED', statusCode: 422 };
  }
  const token = await botToken(args.clientId, args.clientSecret, args.tenantId);
  if (!token) return { success: false, error: 'Failed to acquire Bot Framework token', errorCode: 'GRAPH_TOKEN_FAILED', statusCode: 503 };

  const card = JSON.parse(args.cardJson) as unknown;
  const conversationId = args.conversationId?.trim();
  if (!conversationId) {
    return { success: false, error: 'Stored Teams message reference is missing its conversation ID', errorCode: 'MESSAGE_REFERENCE_INVALID' };
  }

  // Bot Framework update: PUT {serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}
  const endpoint = `${serviceUrl}/v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(args.messageId)}`;
  const body = {
    type: 'message',
    id: args.messageId,
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }],
    channelData: { tenant: { id: args.tenantId } },
  };
  const res = await retryFetch(
    endpoint,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
    { maxAttempts: 2, initialDelayMs: 800 }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const s = res.status;
    if (s === 429) {
      const raw = res.headers?.get?.('Retry-After');
      const n = raw ? Number.parseInt(raw, 10) : NaN;
      const retryAfterMs = Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
      return { success: false, error: 'Teams rate limited', errorCode: 'RATE_LIMITED', statusCode: 429, retryAfterMs };
    }
    // Bot Connector returns 403 when the bot is removed or not allowed to edit; treat as MESSAGE_NOT_FOUND for recover path,
    // except preserve PATCH_NOT_SUPPORTED compat for callers that expect DEGRADED on Graph.
    if (s === 404) return { success: false, error: 'Teams message not found', errorCode: 'MESSAGE_NOT_FOUND', statusCode: 404 };
    if (s === 403) {
      // Distinguish between auth expiry and removal — surface as AUTH_EXPIRED so caller can re-probe.
      if (/not.?found|does not exist/i.test(text)) {
        return { success: false, error: text.slice(0, 600) || `HTTP ${s}`, errorCode: 'MESSAGE_NOT_FOUND', statusCode: 404 };
      }
      return { success: false, error: text.slice(0, 600) || `HTTP ${s}`, errorCode: 'AUTH_EXPIRED', statusCode: s };
    }
    return { success: false, error: text.slice(0, 600) || `HTTP ${s}`, errorCode: `http_${s}`, statusCode: s };
  }
  return { success: true, providerMessageId: args.messageId, conversationId };
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
  beforeCreateAttempt?: () => Promise<void>;
}): Promise<TeamsDeliveryResult> {
  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return { success: false, error: 'Microsoft Teams is not configured', errorCode: 'NOT_CONFIGURED', statusCode: 422 };
  const tenantId = resolveTenantForCall(args.tenantId, resolved.config.tenantId);
  if (!tenantId) return { success: false, error: 'Teams tenant is not configured', errorCode: 'TENANT_REQUIRED', statusCode: 422 };

  const cardObj = buildMicrosoftTeamsIncidentCard(
    { incident: args.incident, eventType: args.eventType },
    { disableActions: args.disableActions },
  );
  // Resolve serviceUrl + botRecipientId from Installation (verified via Bot Framework conversationUpdate).
  // Send path uses tenantId+teamId to avoid trusting channel-scoped caller input alone.
  let serviceUrl = '';
  let botRecipientId: string | null = null;
  try {
    const inst = await resolveServiceUrlForDestination(tenantId, args.teamId);
    serviceUrl = inst.serviceUrl ?? '';
    botRecipientId = inst.botRecipientId ?? null;
  } catch {
    serviceUrl = '';
  }
  return sendBotActivity({
    serviceUrl,
    botRecipientId,
    teamId: args.teamId,
    channelId: args.channelId,
    cardJson: JSON.stringify(cardObj),
    incidentId: args.incident.id,
    clientId: resolved.config.clientId,
    clientSecret: resolved.clientSecret,
    tenantId,
    beforeCreateAttempt: args.beforeCreateAttempt,
  });
}

export async function updateMicrosoftTeamsIncidentCard(args: {
  tenantId: string;
  teamId: string;
  channelId: string;
  messageId: string;
  conversationId?: string | null;
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
    conversationId: args.conversationId ?? null,
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
  installations: TeamsRscInstallationState[];
};

export type TeamsRscInstallationState = {
  teamId: string;
  teamName: string | null;
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
    return { granted: null, missing: required, unknown: true, error: 'NOT_CONFIGURED', installations: [] };
  }
  const tenantId = resolveTenantForCall(options?.explicitTenantId, resolved.config.tenantId);
  if (!tenantId) {
    return { granted: null, missing: required, unknown: true, error: 'TENANT_REQUIRED', installations: [] };
  }

  const token = await graphToken(resolved.config.clientId, resolved.clientSecret, tenantId);
  if (!token) {
    return { granted: null, missing: required, unknown: true, error: 'GRAPH_TOKEN_FAILED', installations: [] };
  }

  // Probe the exact capability OpsKnight needs. The permissionGrants endpoint
  // itself requires a broader Graph permission, so using it to verify minimal
  // RSC creates a circular and misleading health check.
  try {
    const prismaForTeams = (await import('@/lib/prisma')).default as unknown as {
      microsoftTeamsInstallation: { findMany: (a: unknown) => Promise<Array<{ teamId: string; teamName: string | null }>> };
    };
    const installations = await prismaForTeams.microsoftTeamsInstallation.findMany({
      where: { tenantId, enabled: true },
      select: { teamId: true, teamName: true },
      orderBy: { teamName: 'asc' },
      take: 100,
    });

    if (installations.length === 0) {
      return { granted: null, missing: required, unknown: true, error: 'NO_TEAMS_INSTALLED', installations: [] };
    }

    const installationStates: TeamsRscInstallationState[] = [];

    for (const inst of installations) {
      const res = await retryFetch(
        `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(inst.teamId)}/channels?$top=1&$select=id`,
        { headers: { Authorization: `Bearer ${token}` } },
        { maxAttempts: 2, initialDelayMs: 500 },
      );
      if (!res.ok) {
        const error = res.status === 401 || res.status === 403
          ? 'CHANNEL_DISCOVERY_PERMISSION_DENIED'
          : res.status === 404 ? 'TEAM_NOT_FOUND' : `http_${res.status}`;
        installationStates.push({
          teamId: inst.teamId,
          teamName: inst.teamName,
          granted: res.status === 401 || res.status === 403 ? [] : null,
          missing: required,
          unknown: res.status !== 401 && res.status !== 403,
          error,
        });
        continue;
      }
      try {
        const data = (await res.json()) as { value?: unknown[] };
        if (!Array.isArray(data.value)) throw new Error('Invalid channels response');
        installationStates.push({
          teamId: inst.teamId,
          teamName: inst.teamName,
          // A successful channel list proves the required discovery capability.
          // This is capability evidence, not an enumeration of every RSC grant.
          granted: required,
          missing: [],
          unknown: false,
        });
      } catch {
        installationStates.push({ teamId: inst.teamId, teamName: inst.teamName, granted: null, missing: required, unknown: true, error: 'INVALID_RESPONSE' });
      }
    }

    const unknown = installationStates.some(state => state.unknown);
    const missing = [...new Set(installationStates.flatMap(state => state.missing))];
    const knownStates = installationStates.filter(state => !state.unknown && state.granted);
    const granted = unknown || knownStates.length === 0
      ? null
      : required.filter(permission => knownStates.every(state => state.granted!.includes(permission)));
    return {
      granted,
      missing,
      unknown,
      error: unknown ? 'ONE_OR_MORE_INSTALLATIONS_UNVERIFIED' : undefined,
      installations: installationStates,
    };
  } catch (e) {
    return {
      granted: null,
      missing: required,
      unknown: true,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
      installations: [],
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
  // Derive tenant from installation when caller omits it (MULTI mode).
  // This ensures channels are scoped to a verified installation, never a raw teamId.
  let tenantId = resolveTenantForCall(options?.tenantId, resolved.config.tenantId);
  if (!tenantId) {
    const prismaForLookup = (await import('@/lib/prisma')).default as unknown as {
      microsoftTeamsInstallation: { findFirst: (a: unknown) => Promise<{ tenantId: string } | null> };
    };
    const inst = await prismaForLookup.microsoftTeamsInstallation.findFirst({
      where: { teamId: tid, enabled: true },
      select: { tenantId: true },
    } as never);
    if (inst?.tenantId) tenantId = inst.tenantId;
  }
  if (!tenantId) return { channels: [], error: 'TENANT_REQUIRED' };
  // Verify the team is actually installed (prevents probing arbitrary teamIds)
  const prismaForCheck = (await import('@/lib/prisma')).default as unknown as {
    microsoftTeamsInstallation: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
  };
  const hasInstallation = await prismaForCheck.microsoftTeamsInstallation.findFirst({
    where: { tenantId, teamId: tid, enabled: true },
    select: { id: true },
  } as never);
  if (!hasInstallation) return { channels: [], error: 'APP_NOT_INSTALLED' };
  const token = await graphToken(resolved.config.clientId, resolved.clientSecret, tenantId);
  if (!token) return { channels: [], error: 'GRAPH_TOKEN_FAILED' };
  const channels: Array<{ id: string; displayName: string; description?: string | null }> = [];
  const seen = new Set<string>();
  let nextUrl: string | null = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(tid)}/channels?$top=100&$select=id,displayName,description`;
  // Bound traversal so a malformed or cyclic provider response cannot monopolize a worker.
  for (let page = 0; nextUrl && page < 10 && channels.length < 1_000; page += 1) {
    const parsedUrl = new URL(nextUrl);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'graph.microsoft.com') {
      return { channels: [], error: 'Graph returned an untrusted pagination URL' };
    }
    const res = await retryFetch(
      nextUrl,
      { headers: { Authorization: `Bearer ${token}` } },
      { maxAttempts: 2, initialDelayMs: 600 },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { channels: [], error: body.slice(0, 400) || `HTTP ${res.status}` };
    }
    try {
      const data = (await res.json()) as {
        value?: Array<{ id: string; displayName: string; description?: string | null }>;
        '@odata.nextLink'?: string;
      };
      if (!Array.isArray(data.value)) return { channels: [], error: 'Failed to parse channels list' };
      for (const channel of data.value) {
        if (!channel.id || !channel.displayName || seen.has(channel.id)) continue;
        seen.add(channel.id);
        channels.push({ id: channel.id, displayName: channel.displayName, description: channel.description ?? null });
      }
      nextUrl = typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null;
    } catch {
      return { channels: [], error: 'Failed to parse channels list' };
    }
  }
  return { channels };
}
