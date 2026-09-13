import { getMicrosoftTeamsGraphAccessToken } from '../client';
import type { WarRoomGraphResult } from '@/lib/war-room/types';

type Channel = { id: string; displayName: string; description?: string | null; webUrl?: string | null };

function failure(status: number, body: string, retryAfter: string | null): WarRoomGraphResult<never> {
  if (status === 429) return { ok: false, code: 'RATE_LIMITED', message: 'Microsoft Teams rate limited the request.', retryAfterMs: Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : undefined };
  if (status === 401 || status === 403) return { ok: false, code: 'MISSING_PERMISSION', message: 'Microsoft Teams has not granted the required Team-scoped permission.' };
  if (status === 404) return { ok: false, code: 'TEAM_NOT_FOUND', message: 'The configured Microsoft Team no longer exists or the app is not installed.' };
  return { ok: false, code: 'UNKNOWN', message: body.slice(0, 500) || `Microsoft Graph returned HTTP ${status}.` };
}

async function graph(tenantId: string, path: string, init: RequestInit): Promise<WarRoomGraphResult<Response>> {
  const token = await getMicrosoftTeamsGraphAccessToken(tenantId);
  if (!token) return { ok: false, code: 'GRAPH_TOKEN_FAILED', message: 'Unable to obtain a Microsoft Graph access token.' };
  try {
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(30_000) });
    if (response.ok) return { ok: true, value: response };
    return failure(response.status, await response.text().catch(() => ''), response.headers.get('Retry-After'));
  } catch (error) {
    return { ok: false, code: 'AMBIGUOUS_CREATE', message: `Microsoft Graph request outcome is unknown: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function warRoomChannelName(incidentId: string, title: string): string {
  const short = incidentId.slice(-8).toLowerCase();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'incident';
  return `inc-${short}-${slug}`.slice(0, 50);
}

export function warRoomMarker(incidentId: string, generation: number): string {
  return `OpsKnight war room | incident=${incidentId} | generation=${generation}`;
}

export async function createChannel(input: { tenantId: string; teamId: string; displayName: string; description: string; membershipType: 'STANDARD' | 'PRIVATE' }): Promise<WarRoomGraphResult<Channel>> {
  const result = await graph(input.tenantId, `/teams/${encodeURIComponent(input.teamId)}/channels`, { method: 'POST', body: JSON.stringify({ displayName: input.displayName, description: input.description, membershipType: input.membershipType.toLowerCase() }) });
  if (!result.ok) return result;
  const channel = await result.value.json().catch(() => null) as Channel | null;
  return channel?.id && channel.displayName ? { ok: true, value: channel } : { ok: false, code: 'AMBIGUOUS_CREATE', message: 'Microsoft Graph created a channel but returned an incomplete response.' };
}

/** Reconciliation is marker-based, never name-only, to avoid adopting an unrelated channel. */
export async function findWarRoomChannel(input: { tenantId: string; teamId: string; marker: string }): Promise<WarRoomGraphResult<Channel | null>> {
  const result = await graph(input.tenantId, `/teams/${encodeURIComponent(input.teamId)}/channels?$top=100&$select=id,displayName,description,webUrl`, { method: 'GET' });
  if (!result.ok) return result;
  const body = await result.value.json().catch(() => null) as { value?: Channel[] } | null;
  const value = body?.value?.find(channel => channel.description?.includes(input.marker)) ?? null;
  return { ok: true, value };
}

export async function updateChannel(input: { tenantId: string; teamId: string; channelId: string; displayName?: string; description?: string }): Promise<WarRoomGraphResult<null>> {
  const result = await graph(input.tenantId, `/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}`, { method: 'PATCH', body: JSON.stringify({ ...(input.displayName ? { displayName: input.displayName } : {}), ...(input.description ? { description: input.description } : {}) }) });
  return result.ok ? { ok: true, value: null } : result;
}
