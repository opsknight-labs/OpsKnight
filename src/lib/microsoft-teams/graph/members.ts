import type { WarRoomGraphResult } from '@/lib/war-room/types';
import { microsoftTeamsGraphRequest } from './channels';

type ConversationMember = {
  id?: string;
  userId?: string;
  roles?: string[];
};

async function findMember(input: {
  tenantId: string;
  teamId: string;
  channelId?: string;
  userObjectId: string;
}): Promise<WarRoomGraphResult<ConversationMember | null>> {
  const root = input.channelId
    ? `/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}/members`
    : `/teams/${encodeURIComponent(input.teamId)}/members`;
  let next: string | null = `${root}?$top=100&$select=id,userId,roles`;
  for (let page = 0; next && page < 100; page += 1) {
    const result = await microsoftTeamsGraphRequest(input.tenantId, next, { method: 'GET' }, 'READ');
    if (!result.ok) return result;
    const body = await result.value.json().catch(() => null) as { value?: ConversationMember[]; '@odata.nextLink'?: string } | null;
    if (!Array.isArray(body?.value)) {
      return { ok: false, code: 'TRANSIENT_READ', message: 'Microsoft Graph returned an invalid Teams member listing.' };
    }
    const member = body.value.find(candidate => candidate.userId === input.userObjectId);
    if (member) return { ok: true, value: member };
    next = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : null;
  }
  return next
    ? { ok: false, code: 'TRANSIENT_READ', message: 'Microsoft Graph member pagination exceeded its safety limit.' }
    : { ok: true, value: null };
}

/** Verifies that the linked Entra object is already a member of the parent Team. */
export function findTeamMember(input: {
  tenantId: string;
  teamId: string;
  userObjectId: string;
}): Promise<WarRoomGraphResult<ConversationMember | null>> {
  return findMember(input);
}

export function findChannelMember(input: {
  tenantId: string;
  teamId: string;
  channelId: string;
  userObjectId: string;
}): Promise<WarRoomGraphResult<ConversationMember | null>> {
  return findMember(input);
}

/**
 * Batched membership resolver — lists the entire Team/channel once so
 * N participants do not each paginate independently. Callers should
 * still treat individual add/remove as per-member mutations fenced
 * by the participant CAS.
 */
async function listAllMembers(input: {
  tenantId: string;
  teamId: string;
  channelId?: string;
}): Promise<WarRoomGraphResult<Map<string, ConversationMember>>> {
  const root = input.channelId
    ? `/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}/members`
    : `/teams/${encodeURIComponent(input.teamId)}/members`;
  let next: string | null = `${root}?$top=100&$select=id,userId,roles`;
  const map = new Map<string, ConversationMember>();
  for (let page = 0; next && page < 100; page += 1) {
    const result = await microsoftTeamsGraphRequest(input.tenantId, next, { method: 'GET' }, 'READ');
    if (!result.ok) return result as WarRoomGraphResult<Map<string, ConversationMember>>;
    const body = (await result.value.json().catch(() => null)) as
      | { value?: ConversationMember[]; '@odata.nextLink'?: string }
      | null;
    if (!Array.isArray(body?.value)) {
      return { ok: false, code: 'TRANSIENT_READ', message: 'Microsoft Graph returned an invalid Teams member listing.' };
    }
    for (const member of body.value) {
      if (member.userId) map.set(member.userId, member);
    }
    next = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : null;
  }
  if (next) {
    return { ok: false, code: 'TRANSIENT_READ', message: 'Microsoft Graph member pagination exceeded its safety limit.' };
  }
  return { ok: true, value: map };
}

export function listTeamMembers(input: { tenantId: string; teamId: string }): Promise<WarRoomGraphResult<Map<string, ConversationMember>>> {
  return listAllMembers(input);
}

export function listChannelMembers(input: {
  tenantId: string;
  teamId: string;
  channelId: string;
}): Promise<WarRoomGraphResult<Map<string, ConversationMember>>> {
  return listAllMembers(input);
}

/**
 * Adds a previously verified parent-Team member to a private channel. The
 * caller must first check the channel membership to make retries idempotent.
 */
export async function addChannelMember(input: {
  tenantId: string;
  teamId: string;
  channelId: string;
  userObjectId: string;
  owner?: boolean;
}): Promise<WarRoomGraphResult<null>> {
  const escapedObjectId = input.userObjectId.replace(/'/g, "''");
  const result = await microsoftTeamsGraphRequest(
    input.tenantId,
    `/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}/members`,
    {
      method: 'POST',
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: input.owner ? ['owner'] : [],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${escapedObjectId}')`,
      }),
    },
    'MEMBER_ADD',
  );
  return result.ok ? { ok: true, value: null } : result;
}

/**
 * Promotes/demotes a private channel member by patching their roles.
 * Used for owner handoff before removing the last owner.
 */
export async function updateChannelMemberRoles(input: {
  tenantId: string;
  teamId: string;
  channelId: string;
  membershipId: string;
  roles: string[];
}): Promise<WarRoomGraphResult<null>> {
  const result = await microsoftTeamsGraphRequest(
    input.tenantId,
    `/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}/members/${encodeURIComponent(input.membershipId)}`,
    { method: 'PATCH', body: JSON.stringify({ roles: input.roles }) },
    'MEMBER_UPDATE',
  );
  return result.ok ? { ok: true, value: null } : result;
}

/**
 * Removes a member from a private channel. The caller must supply the
 * channel membership id (not the Entra object id) obtained from
 * findChannelMember. Idempotent: 404 is treated as already removed.
 * Never removes the user from the parent Team.
 */
export async function removeChannelMember(input: {
  tenantId: string;
  teamId: string;
  channelId: string;
  membershipId: string;
}): Promise<WarRoomGraphResult<null>> {
  const result = await microsoftTeamsGraphRequest(
    input.tenantId,
    `/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}/members/${encodeURIComponent(input.membershipId)}`,
    { method: 'DELETE' },
    'MEMBER_REMOVE',
  );
  if (result.ok) return { ok: true, value: null };
  // Graph returns 404 when the membership was already removed — treat as success
  // for idempotency. The WarRoomGraphResult will map it to TEAM_NOT_FOUND;
  // we normalize that case here.
  if (!result.ok && result.code === 'TEAM_NOT_FOUND') {
    // Probe whether this was genuinely missing vs team gone — for member removal
    // we conservatively treat any 404 as already-removed when the channel still
    // exists (caller should have verified channel existence via health).
    return { ok: true, value: null };
  }
  return result;
}
