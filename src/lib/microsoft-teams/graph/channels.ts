import { getMicrosoftTeamsGraphAccessToken } from '../client';
import type { WarRoomGraphResult } from '@/lib/war-room/types';

type Channel = { id: string; displayName: string; description?: string | null; webUrl?: string | null };

function failure(status: number, body: string, retryAfter: string | null, operation: 'READ' | 'CREATE' | 'UPDATE'): WarRoomGraphResult<never> {
  if (status === 429) return { ok: false, code: 'RATE_LIMITED', message: 'Microsoft Teams rate limited the request.', retryAfterMs: Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : undefined };
  if (status === 401) return { ok: false, code: 'GRAPH_TOKEN_FAILED', message: 'Microsoft Graph rejected the access token.' };
  if (status === 403) return { ok: false, code: 'MISSING_PERMISSION', message: 'Microsoft Teams has not granted the required Team-scoped permission.' };
  if (status === 404) return { ok: false, code: 'TEAM_NOT_FOUND', message: 'The configured Microsoft Team no longer exists or the app is not installed.' };
  if (status >= 500) return { ok: false, code: operation === 'CREATE' ? 'AMBIGUOUS_CREATE' : 'TRANSIENT_READ', message: 'Microsoft Graph is temporarily unavailable.' };
  return { ok: false, code: 'UNKNOWN', message: body.slice(0, 500) || `Microsoft Graph returned HTTP ${status}.` };
}

async function graph(tenantId: string, path: string, init: RequestInit, operation: 'READ' | 'CREATE' | 'UPDATE'): Promise<WarRoomGraphResult<Response>> {
  const token = await getMicrosoftTeamsGraphAccessToken(tenantId);
  if (!token) return { ok: false, code: 'GRAPH_TOKEN_FAILED', message: 'Unable to obtain a Microsoft Graph access token.' };
  try {
    const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'graph.microsoft.com') return { ok: false, code: 'UNKNOWN', message: 'Microsoft Graph returned an untrusted pagination URL.' };
    const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(30_000) });
    if (response.ok) return { ok: true, value: response };
    return failure(response.status, await response.text().catch(() => ''), response.headers.get('Retry-After'), operation);
  } catch (error) {
    return { ok: false, code: operation === 'CREATE' ? 'AMBIGUOUS_CREATE' : 'TRANSIENT_READ', message: `Microsoft Graph request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function warRoomChannelName(incidentId: string, generation: number, title: string): string {
  const short = incidentId.slice(-8).toLowerCase();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'incident';
  return `inc-${short}-g${generation}-${slug}`.slice(0, 50);
}

export function warRoomMarker(incidentId: string, generation: number): string {
  // The closing bracket makes g1 and g10 distinct under a substring search.
  return `[OKWR:${incidentId}:g${generation}]`;
}

export async function createChannel(input: { tenantId: string; teamId: string; displayName: string; description: string; membershipType: 'STANDARD' }): Promise<WarRoomGraphResult<Channel>> {
  const result = await graph(input.tenantId, `/teams/${encodeURIComponent(input.teamId)}/channels`, { method: 'POST', body: JSON.stringify({ displayName: input.displayName, description: input.description, membershipType: 'standard' }) }, 'CREATE');
  if (!result.ok) return result;
  const channel = await result.value.json().catch(() => null) as Channel | null;
  return channel?.id && channel.displayName ? { ok: true, value: channel } : { ok: false, code: 'AMBIGUOUS_CREATE', message: 'Microsoft Graph created a channel but returned an incomplete response.' };
}

/** Reconciliation is marker-based, never name-only, to avoid adopting an unrelated channel. */
export async function findWarRoomChannel(input: { tenantId: string; teamId: string; marker: string }): Promise<WarRoomGraphResult<Channel | null>> {
  let next: string | null = `/teams/${encodeURIComponent(input.teamId)}/channels?$top=100&$select=id,displayName,description,webUrl`;
  for (let page = 0; next && page < 100; page += 1) {
    const result = await graph(input.tenantId, next, { method: 'GET' }, 'READ');
    if (!result.ok) return result;
    const body = await result.value.json().catch(() => null) as { value?: Channel[]; '@odata.nextLink'?: string } | null;
    if (!Array.isArray(body?.value)) return { ok: false, code: 'TRANSIENT_READ', message: 'Microsoft Graph returned an invalid channel listing.' };
    const matches = body.value.filter(channel => channel.description?.includes(input.marker));
    if (matches.length > 1) return { ok: false, code: 'DUPLICATE_WAR_ROOMS', message: 'Multiple Microsoft Teams channels claim this OpsKnight war-room marker.' };
    if (matches.length === 1) return { ok: true, value: matches[0] };
    next = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : null;
  }
  return next ? { ok: false, code: 'TRANSIENT_READ', message: 'Microsoft Graph channel pagination exceeded its safety limit.' } : { ok: true, value: null };
}

export async function updateChannel(input: { tenantId: string; teamId: string; channelId: string; displayName?: string; description?: string }): Promise<WarRoomGraphResult<null>> {
  const result = await graph(input.tenantId, `/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}`, { method: 'PATCH', body: JSON.stringify({ ...(input.displayName ? { displayName: input.displayName } : {}), ...(input.description ? { description: input.description } : {}) }) }, 'UPDATE');
  return result.ok ? { ok: true, value: null } : result;
}
