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
