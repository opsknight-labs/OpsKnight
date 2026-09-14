import 'server-only';

import prisma from '@/lib/prisma';
import {
  addChannelMember,
  listChannelMembers,
  listTeamMembers,
  removeChannelMember,
} from '@/lib/microsoft-teams/graph/members';
import { scheduleJob } from '@/lib/jobs/queue';
import { WarRoomRetryableError } from './microsoft-teams';

type ResponderSource = 'ASSIGNEE' | 'WATCHER';

function isRetryableMemberGraphCode(code: string): boolean {
  return code === 'RATE_LIMITED' || code === 'TRANSIENT_READ' || code === 'GRAPH_TOKEN_FAILED';
}

async function validateParticipantSyncAuthority(room: {
  destinationId: string | null;
  installationId: string | null;
  providerTenantId: string | null;
  providerContainerId: string | null;
  state: string;
}): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
  if (!room.destinationId) return { allowed: false, code: 'DESTINATION_SNAPSHOT_MISSING', message: 'War-room routing snapshot is missing.' };
  if (room.state !== 'READY') return { allowed: false, code: 'WAR_ROOM_STATE_INVALID', message: `War-room state ${room.state} does not permit member sync.` };
  const [config, destination, installation] = await Promise.all([
    prisma.microsoftTeamsConfig.findFirst({ where: { enabled: true, warRoomsEnabled: true }, select: { id: true } }),
    prisma.microsoftTeamsDestination.findUnique({ where: { id: room.destinationId }, select: { enabled: true, warRoomEnabled: true, installationId: true, tenantId: true, teamId: true } }),
    room.installationId ? prisma.microsoftTeamsInstallation.findUnique({ where: { id: room.installationId }, select: { enabled: true } }) : Promise.resolve(null),
  ]);
  if (!config) return { allowed: false, code: 'WAR_ROOM_AUTHORITY_REVOKED', message: 'Microsoft Teams war-room configuration was disabled.' };
  if (!destination?.enabled || !destination.warRoomEnabled) return { allowed: false, code: 'WAR_ROOM_DESTINATION_REVOKED', message: 'Microsoft Teams war-room destination was disabled.' };
  if (room.installationId && (!installation?.enabled || destination.installationId !== room.installationId)) return { allowed: false, code: 'WAR_ROOM_INSTALLATION_REVOKED', message: 'Microsoft Teams installation was disabled.' };
  if (room.providerTenantId && destination.tenantId !== room.providerTenantId) return { allowed: false, code: 'WAR_ROOM_TENANT_MISMATCH', message: 'War-room tenant no longer matches its destination.' };
  if (room.providerContainerId && destination.teamId !== room.providerContainerId) return { allowed: false, code: 'WAR_ROOM_TEAM_MISMATCH', message: 'War-room team no longer matches its destination.' };
  return { allowed: true };
}

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
  state: 'PENDING' | 'PRESENT' | 'SKIPPED' | 'FAILED' | 'REMOVED';
  code?: string | null;
  message?: string | null;
  added?: boolean;
}): Promise<boolean> {
  const now = new Date();
  // CAS fencing: never resurrect a REMOVED row into PRESENT/PENDING. The
  // projection owns the DESIRED→REMOVED transition; the sync may only advance
  // DESIRED/PENDING/FAILED forward, or keep REMOVED stable. When a REMOVED
  // removal fails, we surface FAILED so operators see "Removal requested —
  // Teams removal failed" instead of silently leaving REMOVED with null error.
  const allowedPrior =
    input.state === 'REMOVED'
      ? (['REMOVED', 'DESIRED', 'PENDING', 'FAILED', 'PRESENT', 'PROCESSING'] as const)
      : input.state === 'PENDING'
        ? (['DESIRED', 'PENDING', 'FAILED'] as const)
        : input.state === 'FAILED'
          ? (['DESIRED', 'PENDING', 'FAILED', 'PRESENT', 'REMOVED', 'PROCESSING'] as const)
          : (['DESIRED', 'PENDING', 'FAILED', 'PRESENT'] as const);
  const changed = await prisma.warRoomParticipant.updateMany({
    where: { id: input.id, state: { in: [...allowedPrior] } } as never,
    data: {
      state: input.state,
      lastSyncAt: now,
      lastErrorCode: input.code ?? null,
      lastError: input.message ?? null,
      ...(input.added ? { addedAt: now } : {}),
    },
  });
  if (changed.count === 1) return true;
  // If CAS fenced the write (projection concurrently marked REMOVED), do not
  // clobber the removal — the next projection cycle will reconcile.
  if (input.state !== 'REMOVED') {
    // Ensure we at least surface the terminal error without reviving the row.
    await prisma.warRoomParticipant.updateMany({
      where: { id: input.id, state: 'REMOVED' },
      data: { lastSyncAt: now, ...(input.state === 'FAILED' ? { lastErrorCode: input.code ?? null, lastError: input.message ?? null } : {}) },
    });
  }
  return false;
}

function throwIfRetryableMemberGraph(result: { ok: false; code: string; message: string; retryAfterMs?: number }): never | void {
  if (isRetryableMemberGraphCode(result.code)) {
    throw new WarRoomRetryableError(result.message, result.retryAfterMs);
  }
}

/**
 * Performs an idempotent provider sync after projection. Standard channels do
 * not mutate parent-Team membership; they only verify each identity is already
 * in the Team. Private rooms also reconcile channel membership before adding
 * and removing. Team/channel membership is batch-loaded once so N participants
 * do not each paginate independently, and each Graph mutation is fenced by a
 * fresh read of the participant row so a concurrent projection that changed
 * desired state does not drive a stale side effect.
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

  const authority = await validateParticipantSyncAuthority(room);
  if (!authority.allowed) {
    // Authority revoked while job was queued — do not leak Graph calls. Keep
    // durable participant state as-is; the revocation path cancels future jobs.
    // Mark a soft failure so operators can see why sync stalled.
    for (const participant of room.participants) {
      if (['DESIRED', 'PENDING', 'FAILED'].includes(participant.state)) {
        await prisma.warRoomParticipant.updateMany({
          where: { id: participant.id, state: { in: ['DESIRED', 'PENDING', 'FAILED'] } },
          data: { lastErrorCode: authority.code, lastError: authority.message, lastSyncAt: new Date() },
        });
      }
    }
    return;
  }

  // Batch-load provider membership once. A single pagination per collection
  // replaces the previous N× per-participant paginated scans.
  const teamMembersResult = await listTeamMembers({ tenantId: room.providerTenantId, teamId: room.providerContainerId });
  if (!teamMembersResult.ok) {
    throwIfRetryableMemberGraph(teamMembersResult);
    // Non-retryable listing failure — mark all pending participants as FAILED.
    for (const participant of room.participants) {
      if (['DESIRED', 'PENDING', 'FAILED'].includes(participant.state)) {
        await persistParticipantOutcome({ id: participant.id, state: 'FAILED', code: teamMembersResult.code, message: teamMembersResult.message });
      }
    }
    return;
  }
  const teamMembersByObjectId = teamMembersResult.value;

  let channelMembersByObjectId: Map<string, { id?: string; userId?: string; roles?: string[] }> | null = null;
  if (room.membershipType === 'PRIVATE' && room.providerChannelId) {
    const channelMembersResult = await listChannelMembers({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId });
    if (!channelMembersResult.ok) {
      throwIfRetryableMemberGraph(channelMembersResult);
      for (const participant of room.participants) {
        if (['DESIRED', 'PENDING', 'FAILED', 'REMOVED'].includes(participant.state) && room.membershipType === 'PRIVATE') {
          await persistParticipantOutcome({ id: participant.id, state: 'FAILED', code: channelMembersResult.code, message: channelMembersResult.message });
        }
      }
      return;
    }
    channelMembersByObjectId = channelMembersResult.value;
  }

  for (const snapshotParticipant of room.participants) {
    // Re-read desired state before any Graph mutation so a concurrent
    // projection that changed this participant (e.g. DESIRED→REMOVED) does not
    // drive a stale add, and a concurrent REMOVED→DESIRED (re-added watcher)
    // does not drive a stale remove.
    const current = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { state: true, updatedAt: true } });
    const effectiveState = current?.state ?? snapshotParticipant.state;
    if (effectiveState !== snapshotParticipant.state) {
      // Desired state changed concurrently — skip this participant; the next
      // sync cycle will reconcile with the fresh desired state.
      continue;
    }

    // Re-validate authority before each mutating Graph call (TOCTOU guard).
    // Cheap: config/destination/installation are cached/row reads; skip if
    // the previous authority check was very recent by reusing the snapshot.
    // We only re-check before mutations, not reads.

    // Removal path: projection marked REMOVED after watcher/assignee left.
    // Private channels must actually remove the Graph membership; standard
    // channels never added a channel member so REMOVED is already terminal.
    if (effectiveState === 'REMOVED') {
      if (room.membershipType !== 'PRIVATE' || !room.providerChannelId || !channelMembersByObjectId) continue;
      const userObjectId = snapshotParticipant.providerObjectId ?? snapshotParticipant.providerUserId;
      if (!userObjectId) {
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'REMOVED' });
        continue;
      }
      const channelMember = channelMembersByObjectId.get(userObjectId) ?? null;
      if (!channelMember) {
        // Already removed — keep REMOVED stable and refresh lastSyncAt.
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'REMOVED' });
        continue;
      }
      const membershipId = (channelMember as { id?: string }).id;
      if (!membershipId) {
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: 'MEMBER_NOT_FOUND', message: 'Channel membership record is missing its identifier.' });
        continue;
      }
      // Re-check authority immediately before the mutating DELETE.
      const authorityBeforeMutate = await validateParticipantSyncAuthority(room);
      if (!authorityBeforeMutate.allowed) {
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: authorityBeforeMutate.code, message: authorityBeforeMutate.message });
        continue;
      }
      // Final freshness fence right before the provider mutation.
      const freshBeforeRemove = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { state: true } });
      if (freshBeforeRemove?.state !== 'REMOVED') continue;
      const removed = await removeChannelMember({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId, membershipId });
      if (!removed.ok) {
        throwIfRetryableMemberGraph(removed);
        // Removal failed — surface FAILED so UI can show "Removal requested —
        // Teams removal failed" instead of silently leaving REMOVED with null error.
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: removed.code, message: removed.message });
        continue;
      }
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'REMOVED' });
      continue;
    }

    if (!['DESIRED', 'PENDING', 'FAILED'].includes(effectiveState)) continue;
    const userObjectId = snapshotParticipant.providerObjectId ?? snapshotParticipant.providerUserId;
    if (!userObjectId) {
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'SKIPPED', code: 'IDENTITY_NOT_LINKED', message: 'No verified Microsoft Teams identity is linked to this responder.' });
      continue;
    }
    // CAS transition DESIRED/FAILED -> PENDING so a concurrent removal is not
    // clobbered by this PENDING write. If fenced, the row was concurrently
    // marked REMOVED — skip Graph work.
    const claimed = await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'PENDING' });
    if (!claimed) continue;
    // Re-check desired freshness after acquiring PENDING — if projection
    // raced and updated the row between our PENDING write and now, the CAS
    // would have succeeded but desired is now stale. Re-read to detect.
    const afterPending = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { state: true } });
    if (afterPending?.state !== 'PENDING') continue;

    const teamMember = teamMembersByObjectId.get(userObjectId) ?? null;
    if (!teamMember) {
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'SKIPPED', code: 'MEMBER_NOT_IN_TEAM', message: 'The linked Microsoft Teams identity is not a member of the parent Team.' });
      continue;
    }
    if (room.membershipType === 'STANDARD') {
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'PRESENT', added: true });
      continue;
    }
    if (!room.providerChannelId || !channelMembersByObjectId) {
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: 'CHANNEL_NOT_FOUND', message: 'The private Microsoft Teams channel is not available for participant sync.' });
      continue;
    }
    const channelMember = channelMembersByObjectId.get(userObjectId) ?? null;
    if (channelMember) {
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'PRESENT', added: true });
      continue;
    }
    // Re-check authority and freshness before the mutating POST.
    const authorityBeforeAdd = await validateParticipantSyncAuthority(room);
    if (!authorityBeforeAdd.allowed) {
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: authorityBeforeAdd.code, message: authorityBeforeAdd.message });
      continue;
    }
    const freshBeforeAdd = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { state: true } });
    if (freshBeforeAdd?.state !== 'PENDING') continue;
    const added = await addChannelMember({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId, userObjectId });
    if (!added.ok && added.code !== 'MEMBER_ALREADY_PRESENT') {
      throwIfRetryableMemberGraph(added);
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: added.code, message: added.message });
      continue;
    }
    await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'PRESENT', added: true });
  }
}

/** Queues responder reconciliation for every active Teams room on an incident. */
export async function requestMicrosoftTeamsWarRoomParticipantSyncForIncident(incidentId: string): Promise<void> {
  const rooms = await prisma.incidentWarRoom.findMany({
    where: { incidentId, provider: 'MICROSOFT_TEAMS', state: 'READY' }, select: { id: true },
  });
  await Promise.all(rooms.map(room => scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId: room.id }, 5)));
}
