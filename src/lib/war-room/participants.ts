import 'server-only';

import prisma from '@/lib/prisma';
import { addChannelMember, findChannelMember, findTeamMember } from '@/lib/microsoft-teams/graph/members';
import { scheduleJob } from '@/lib/jobs/queue';

type ResponderSource = 'ASSIGNEE' | 'WATCHER';

/**
 * Projects responders into durable desired members. Identity resolution is
 * deliberately limited to verified ChatIdentityLink records: email and name
 * lookups would permit an unsafe cross-tenant membership change.
 */
export async function projectMicrosoftTeamsWarRoomParticipants(warRoomId: string): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: { incident: { select: { assigneeId: true, watchers: { select: { userId: true } } } } },
  });
  if (!room || room.provider !== 'MICROSOFT_TEAMS' || !room.providerTenantId) return;

  const responders = new Map<string, ResponderSource>();
  if (room.incident.assigneeId) responders.set(room.incident.assigneeId, 'ASSIGNEE');
  for (const watcher of room.incident.watchers) if (!responders.has(watcher.userId)) responders.set(watcher.userId, 'WATCHER');
  const userIds = [...responders.keys()];
  const links = userIds.length === 0 ? [] : await prisma.chatIdentityLink.findMany({
    where: { provider: 'MICROSOFT_TEAMS', providerTenantId: room.providerTenantId, revokedAt: null, userId: { in: userIds } },
    select: { userId: true, providerUserId: true, providerObjectId: true },
  });
  const byUser = new Map(links.map(link => [link.userId, link]));
  const now = new Date();

  await prisma.$transaction(async tx => {
    // Preserve historical rows but ensure removed responders are never synced.
    await tx.warRoomParticipant.updateMany({
      where: { warRoomId, userId: { notIn: userIds }, state: { in: ['DESIRED', 'PROCESSING', 'PENDING', 'PRESENT', 'FAILED'] } },
      data: { state: 'REMOVED', lastSyncAt: now, lastError: null, lastErrorCode: null },
    });
    for (const [userId, source] of responders) {
      const link = byUser.get(userId);
      const providerObjectId = link?.providerObjectId ?? link?.providerUserId ?? null;
      const data = {
        source,
        providerUserId: link?.providerUserId ?? null,
        providerObjectId,
        state: link && providerObjectId ? 'DESIRED' as const : 'SKIPPED' as const,
        lastError: link && providerObjectId ? null : 'IDENTITY_NOT_LINKED',
        lastErrorCode: link && providerObjectId ? null : 'IDENTITY_NOT_LINKED',
      };
      const existing = await tx.warRoomParticipant.findFirst({ where: { warRoomId, userId } });
      if (existing) await tx.warRoomParticipant.update({ where: { id: existing.id }, data });
      else await tx.warRoomParticipant.create({ data: { warRoomId, userId, ...data } });
    }
  });
}

async function persistParticipantOutcome(input: {
  id: string;
  state: 'PENDING' | 'PRESENT' | 'SKIPPED' | 'FAILED';
  code?: string | null;
  message?: string | null;
  added?: boolean;
}): Promise<void> {
  const now = new Date();
  await prisma.warRoomParticipant.update({
    where: { id: input.id },
    data: {
      state: input.state,
      lastSyncAt: now,
      lastErrorCode: input.code ?? null,
      lastError: input.message ?? null,
      ...(input.added ? { addedAt: now } : {}),
    },
  });
}

/**
 * Performs an idempotent provider sync after projection. Standard channels do
 * not mutate parent-Team membership; they only verify each identity is already
 * in the Team. Private rooms also reconcile channel membership before adding.
 */
export async function syncMicrosoftTeamsWarRoomParticipants(warRoomId: string): Promise<void> {
  await projectMicrosoftTeamsWarRoomParticipants(warRoomId);
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: { participants: true },
  });
  if (
    !room || room.provider !== 'MICROSOFT_TEAMS' || room.state !== 'READY' ||
    !room.providerTenantId || !room.providerContainerId || !room.membershipType
  ) return;

  for (const participant of room.participants) {
    if (!['DESIRED', 'PENDING', 'FAILED'].includes(participant.state)) continue;
    const userObjectId = participant.providerObjectId ?? participant.providerUserId;
    if (!userObjectId) {
      await persistParticipantOutcome({ id: participant.id, state: 'SKIPPED', code: 'IDENTITY_NOT_LINKED', message: 'No verified Microsoft Teams identity is linked to this responder.' });
      continue;
    }
    await persistParticipantOutcome({ id: participant.id, state: 'PENDING' });
    const teamMember = await findTeamMember({ tenantId: room.providerTenantId, teamId: room.providerContainerId, userObjectId });
    if (!teamMember.ok) {
      await persistParticipantOutcome({ id: participant.id, state: 'FAILED', code: teamMember.code, message: teamMember.message });
      continue;
    }
    if (!teamMember.value) {
      await persistParticipantOutcome({ id: participant.id, state: 'SKIPPED', code: 'MEMBER_NOT_IN_TEAM', message: 'The linked Microsoft Teams identity is not a member of the parent Team.' });
      continue;
    }
    if (room.membershipType === 'STANDARD') {
      await persistParticipantOutcome({ id: participant.id, state: 'PRESENT', added: true });
      continue;
    }
    if (!room.providerChannelId) {
      await persistParticipantOutcome({ id: participant.id, state: 'FAILED', code: 'CHANNEL_NOT_FOUND', message: 'The private Microsoft Teams channel is not available for participant sync.' });
      continue;
    }
    const channelMember = await findChannelMember({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId, userObjectId });
    if (!channelMember.ok) {
      await persistParticipantOutcome({ id: participant.id, state: 'FAILED', code: channelMember.code, message: channelMember.message });
      continue;
    }
    if (channelMember.value) {
      await persistParticipantOutcome({ id: participant.id, state: 'PRESENT', added: true });
      continue;
    }
    const added = await addChannelMember({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId, userObjectId });
    if (!added.ok && added.code !== 'MEMBER_ALREADY_PRESENT') {
      await persistParticipantOutcome({ id: participant.id, state: 'FAILED', code: added.code, message: added.message });
      continue;
    }
    await persistParticipantOutcome({ id: participant.id, state: 'PRESENT', added: true });
  }
}

/** Queues responder reconciliation for every active Teams room on an incident. */
export async function requestMicrosoftTeamsWarRoomParticipantSyncForIncident(incidentId: string): Promise<void> {
  const rooms = await prisma.incidentWarRoom.findMany({
    where: { incidentId, provider: 'MICROSOFT_TEAMS', state: 'READY' }, select: { id: true },
  });
  await Promise.all(rooms.map(room => scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId: room.id }, 5)));
}
