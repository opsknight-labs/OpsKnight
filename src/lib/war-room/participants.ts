import 'server-only';

import prisma from '@/lib/prisma';
import {
  addChannelMember,
  listChannelMembers,
  listTeamMembers,
  removeChannelMember,
  updateChannelMemberRoles,
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
    // Bump desiredVersion so concurrent sync workers can detect the generation change.
    if (userIds.length === 0) {
      await tx.warRoomParticipant.updateMany({
        where: { warRoomId, state: { in: ['DESIRED', 'PROCESSING', 'PENDING', 'PRESENT', 'FAILED'] } },
        data: { state: 'REMOVED', desiredVersion: { increment: 1 }, lastSyncAt: now, lastError: null, lastErrorCode: null },
      });
    } else {
      await tx.warRoomParticipant.updateMany({
        where: { warRoomId, userId: { notIn: userIds }, state: { in: ['DESIRED', 'PROCESSING', 'PENDING', 'PRESENT', 'FAILED'] } },
        data: { state: 'REMOVED', desiredVersion: { increment: 1 }, lastSyncAt: now, lastError: null, lastErrorCode: null },
      });
    }
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
      if (existing) {
        // Only bump desiredVersion when desired state materially changes to avoid
        // noisy generations. A repeated DESIRED projection without change keeps version.
        const needsBump = existing.state !== data.state || existing.providerObjectId !== providerObjectId || existing.source !== source;
        if (needsBump) {
          await tx.warRoomParticipant.update({ where: { id: existing.id }, data: { ...data, desiredVersion: { increment: 1 } } });
        } else {
          await tx.warRoomParticipant.update({ where: { id: existing.id }, data });
        }
      } else {
        await tx.warRoomParticipant.create({ data: { warRoomId, userId, ...data, desiredVersion: 1 } });
      }
    }
  });
}

async function persistParticipantOutcome(input: {
  id: string;
  expectedDesiredVersion?: number;
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
    where: { id: input.id, state: { in: [...allowedPrior] }, ...(typeof input.expectedDesiredVersion === 'number' ? { desiredVersion: input.expectedDesiredVersion } : {}) } as never,
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

async function ensureCompensationScheduled(warRoomId: string): Promise<void> {
  // Enqueue an immediate reconciliation so the next sync sees fresh desiredVersion.
  await scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId }, 5).catch(() => {});
}

function isOwnerRole(roles?: string[]): boolean {
  return Array.isArray(roles) && roles.includes('owner');
}

/**
 * Private channel owner handoff. Teams rejects removing the last owner, so
 * before deleting the current owner we must promote another channel member.
 * Returns true if handoff succeeded or was unnecessary, false if no candidate.
 */
async function ensurePrivateOwnerHandoff(input: {
  warRoomId: string;
  authorityRoom: Parameters<typeof validateParticipantSyncAuthority>[0];
  tenantId: string;
  teamId: string;
  channelId: string;
  channelMembersByObjectId: Map<string, { id?: string; userId?: string; roles?: string[] }>;
  teamMembersByObjectId: Map<string, { id?: string; userId?: string; roles?: string[] }>;
  targetUserObjectId: string;
  participants: Array<{ id: string; providerObjectId: string | null; providerUserId: string | null; state: string; desiredVersion: number }>;
}): Promise<{ ok: boolean; code?: string; message?: string }> {
  const targetMember = input.channelMembersByObjectId.get(input.targetUserObjectId);
  const isTargetOwner = isOwnerRole(targetMember?.roles);
  if (!isTargetOwner) return { ok: true };

  // Count owners in channel
  let ownerCount = 0;
  for (const member of input.channelMembersByObjectId.values()) {
    if (isOwnerRole(member.roles)) ownerCount += 1;
  }
  if (ownerCount > 1) return { ok: true };

  // Last owner — need replacement. Prefer a PRESENT participant already in channel, else any Team member that is desired.
  let candidateObjectId: string | null = null;
  let candidateMembershipId: string | null = null;
  let candidateParticipant: (typeof input.participants)[number] | null = null;

  // First, look for channel members who are not the target and correspond to a desired participant
  for (const participant of input.participants) {
    const oid = participant.providerObjectId ?? participant.providerUserId;
    if (!oid || oid === input.targetUserObjectId) continue;
    if (!['DESIRED', 'PENDING', 'PRESENT', 'FAILED'].includes(participant.state)) continue;
    const cm = input.channelMembersByObjectId.get(oid);
    if (cm && cm.id && !isOwnerRole(cm.roles)) {
      candidateObjectId = oid;
      candidateMembershipId = cm.id;
      candidateParticipant = participant;
      break;
    }
  }
  // If no in-channel candidate, try to pick a Team member who is desired but not yet in channel
  if (!candidateMembershipId) {
    for (const participant of input.participants) {
      const oid = participant.providerObjectId ?? participant.providerUserId;
      if (!oid || oid === input.targetUserObjectId) continue;
      if (!['DESIRED', 'PENDING', 'PRESENT', 'FAILED'].includes(participant.state)) continue;
      if (input.teamMembersByObjectId.has(oid) && !input.channelMembersByObjectId.has(oid)) {
        const fresh = await prisma.warRoomParticipant.findUnique({ where: { id: participant.id }, select: { state: true, desiredVersion: true } });
        if (!fresh || !['DESIRED', 'PENDING', 'PRESENT'].includes(fresh.state) || fresh.desiredVersion !== participant.desiredVersion) continue;
        const authorityBeforeOwnerAdd = await validateParticipantSyncAuthority(input.authorityRoom);
        if (!authorityBeforeOwnerAdd.allowed) {
          return { ok: false, code: authorityBeforeOwnerAdd.code, message: authorityBeforeOwnerAdd.message };
        }
        // Will be added as owner by the normal add path — promote by adding as owner
        const added = await addChannelMember({ tenantId: input.tenantId, teamId: input.teamId, channelId: input.channelId, userObjectId: oid, owner: true });
        if (added.ok || added.code === 'MEMBER_ALREADY_PRESENT') {
          const afterAdd = await prisma.warRoomParticipant.findUnique({ where: { id: participant.id }, select: { state: true, desiredVersion: true } });
          if (!afterAdd || !['DESIRED', 'PENDING', 'PRESENT'].includes(afterAdd.state) || afterAdd.desiredVersion !== participant.desiredVersion) await ensureCompensationScheduled(input.warRoomId);
          return { ok: true };
        }
        if (isRetryableMemberGraphCode(added.code)) throw new WarRoomRetryableError(added.message, added.retryAfterMs);
        return { ok: false, code: added.code, message: added.message };
      }
    }
  }

  if (!candidateMembershipId || !candidateObjectId) {
    return { ok: false, code: 'OWNER_HANDOFF_REQUIRED', message: 'Cannot remove the last private-channel owner without another verified member to promote.' };
  }

  const fresh = await prisma.warRoomParticipant.findUnique({ where: { id: candidateParticipant!.id }, select: { state: true, desiredVersion: true } });
  if (!fresh || !['DESIRED', 'PENDING', 'PRESENT'].includes(fresh.state) || fresh.desiredVersion !== candidateParticipant!.desiredVersion) {
    return { ok: false, code: 'OWNER_HANDOFF_REQUIRED', message: 'Replacement owner is no longer a desired responder.' };
  }
  const authorityBeforeOwnerPromote = await validateParticipantSyncAuthority(input.authorityRoom);
  if (!authorityBeforeOwnerPromote.allowed) {
    return { ok: false, code: authorityBeforeOwnerPromote.code, message: authorityBeforeOwnerPromote.message };
  }

  const promoted = await updateChannelMemberRoles({ tenantId: input.tenantId, teamId: input.teamId, channelId: input.channelId, membershipId: candidateMembershipId, roles: ['owner'] });
  if (!promoted.ok) {
    if (isRetryableMemberGraphCode(promoted.code)) throw new WarRoomRetryableError(promoted.message, promoted.retryAfterMs);
    return { ok: false, code: promoted.code, message: promoted.message };
  }
  // Update local map so subsequent removals see new owner
  const existing = input.channelMembersByObjectId.get(candidateObjectId);
  if (existing) existing.roles = ['owner'];
  const afterPromote = await prisma.warRoomParticipant.findUnique({ where: { id: candidateParticipant!.id }, select: { state: true, desiredVersion: true } });
  if (!afterPromote || !['DESIRED', 'PENDING', 'PRESENT'].includes(afterPromote.state) || afterPromote.desiredVersion !== candidateParticipant!.desiredVersion) await ensureCompensationScheduled(input.warRoomId);
  return { ok: true };
}

/**
 * Performs an idempotent provider sync after projection. Standard channels do
 * not mutate parent-Team membership; they only verify each identity is already
 * in the Team. Private rooms also reconcile channel membership before adding
 * and removing. Team/channel membership is batch-loaded once so N participants
 * do not each paginate independently, and each Graph mutation is fenced by a
 * fresh read of the participant row and desiredVersion so a concurrent
 * projection that changed desired state triggers compensation.
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
        await persistParticipantOutcome({ id: participant.id, state: 'FAILED', code: teamMembersResult.code, message: teamMembersResult.message, expectedDesiredVersion: participant.desiredVersion });
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
          await persistParticipantOutcome({ id: participant.id, state: 'FAILED', code: channelMembersResult.code, message: channelMembersResult.message, expectedDesiredVersion: participant.desiredVersion });
        }
      }
      return;
    }
    channelMembersByObjectId = channelMembersResult.value;
  }

  for (const snapshotParticipant of room.participants) {
    // Re-read desired state and generation before any Graph mutation so a concurrent
    // projection that changed this participant (e.g. DESIRED→REMOVED) does not
    // drive a stale add, and a concurrent REMOVED→DESIRED (re-added watcher)
    // does not drive a stale remove.
    const current = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { state: true, desiredVersion: true, updatedAt: true } });
    const effectiveState = current?.state ?? snapshotParticipant.state;
    const snapshotDesiredVersion = current?.desiredVersion ?? (snapshotParticipant as unknown as { desiredVersion?: number }).desiredVersion ?? 0;
    if (current && effectiveState !== snapshotParticipant.state) {
      // Desired state changed concurrently — skip this participant; the next
      // sync cycle will reconcile with the fresh desired state.
      continue;
    }

    // Removal path: projection marked REMOVED after watcher/assignee left.
    // Private channels must actually remove the Graph membership; standard
    // channels never added a channel member so REMOVED is already terminal.
    if (effectiveState === 'REMOVED') {
      if (room.membershipType !== 'PRIVATE' || !room.providerChannelId || !channelMembersByObjectId) continue;
      const userObjectId = snapshotParticipant.providerObjectId ?? snapshotParticipant.providerUserId;
      if (!userObjectId) {
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'REMOVED', expectedDesiredVersion: snapshotDesiredVersion });
        continue;
      }
      const channelMember = channelMembersByObjectId.get(userObjectId) ?? null;
      if (!channelMember) {
        // Already removed — keep REMOVED stable and refresh lastSyncAt.
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'REMOVED', expectedDesiredVersion: snapshotDesiredVersion });
        continue;
      }
      const membershipId = (channelMember as { id?: string }).id;
      if (!membershipId) {
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: 'MEMBER_NOT_FOUND', message: 'Channel membership record is missing its identifier.', expectedDesiredVersion: snapshotDesiredVersion });
        continue;
      }
      // Private owner handoff: promote replacement owner before deleting current owner.
      const handoff = await ensurePrivateOwnerHandoff({
        warRoomId,
        authorityRoom: room,
        tenantId: room.providerTenantId,
        teamId: room.providerContainerId,
        channelId: room.providerChannelId,
        channelMembersByObjectId,
        teamMembersByObjectId,
        targetUserObjectId: userObjectId,
        participants: room.participants,
      });
      if (!handoff.ok) {
        if (handoff.code === 'OWNER_HANDOFF_REQUIRED') {
          await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: handoff.code, message: handoff.message, expectedDesiredVersion: snapshotDesiredVersion });
          continue;
        }
        throwIfRetryableMemberGraph({ ok: false, code: handoff.code!, message: handoff.message! });
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: handoff.code, message: handoff.message, expectedDesiredVersion: snapshotDesiredVersion });
        continue;
      }
      // Re-check authority immediately before the mutating DELETE.
      const authorityBeforeMutate = await validateParticipantSyncAuthority(room);
      if (!authorityBeforeMutate.allowed) {
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: authorityBeforeMutate.code, message: authorityBeforeMutate.message, expectedDesiredVersion: snapshotDesiredVersion });
        continue;
      }
      // Final freshness fence right before the provider mutation — check both state and desiredVersion.
      const freshBeforeRemove = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { state: true, desiredVersion: true } });
      if (freshBeforeRemove?.state !== 'REMOVED' || freshBeforeRemove.desiredVersion !== snapshotDesiredVersion) continue;
      const removed = await removeChannelMember({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId, membershipId });
      if (!removed.ok) {
        throwIfRetryableMemberGraph(removed);
        // Removal failed — surface FAILED so UI can show "Removal requested —
        // Teams removal failed" instead of silently leaving REMOVED with null error.
        await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: removed.code, message: removed.message, expectedDesiredVersion: snapshotDesiredVersion });
        continue;
      }
      const persisted = await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'REMOVED', expectedDesiredVersion: snapshotDesiredVersion });
      // Compensation: if desiredVersion changed while the DELETE was in flight, the
      // provider side effect is now stale (we removed someone who was re-added).
      // Detect via version bump and enqueue immediate reconciliation.
      if (!persisted) {
        // CAS fenced — version changed, provider state may be stale; schedule reconcile.
        await ensureCompensationScheduled(warRoomId);
      } else {
        const afterRemove = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { desiredVersion: true, state: true } });
        if (afterRemove && afterRemove.desiredVersion !== snapshotDesiredVersion) {
          // Version bumped after our write — e.g., concurrent projection re-added. Compensate.
          if (afterRemove.state !== 'REMOVED') {
            await ensureCompensationScheduled(warRoomId);
          }
        }
      }
      // Keep local map in sync
      channelMembersByObjectId.delete(userObjectId);
      continue;
    }

    if (!['DESIRED', 'PENDING', 'FAILED'].includes(effectiveState)) continue;
    const userObjectId = snapshotParticipant.providerObjectId ?? snapshotParticipant.providerUserId;
    if (!userObjectId) {
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'SKIPPED', code: 'IDENTITY_NOT_LINKED', message: 'No verified Microsoft Teams identity is linked to this responder.', expectedDesiredVersion: snapshotDesiredVersion });
      continue;
    }
    // CAS transition DESIRED/FAILED -> PENDING so a concurrent removal is not
    // clobbered by this PENDING write. If fenced, the row was concurrently
    // marked REMOVED — skip Graph work.
    const claimed = await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'PENDING', expectedDesiredVersion: snapshotDesiredVersion });
    if (!claimed) continue;
    // Re-check desired freshness after acquiring PENDING — if projection
    // raced and updated the row between our PENDING write and now, the CAS
    // would have succeeded but desired is now stale. Re-read to detect.
    const afterPending = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { state: true, desiredVersion: true } });
    if (afterPending?.state !== 'PENDING') continue;
    if (afterPending.desiredVersion !== snapshotDesiredVersion) {
      // Version changed while acquiring PENDING — stale, let next cycle handle.
      continue;
    }

    const teamMember = teamMembersByObjectId.get(userObjectId) ?? null;
    if (!teamMember) {
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'SKIPPED', code: 'MEMBER_NOT_IN_TEAM', message: 'The linked Microsoft Teams identity is not a member of the parent Team.', expectedDesiredVersion: snapshotDesiredVersion });
      continue;
    }
    if (room.membershipType === 'STANDARD') {
      const persisted = await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'PRESENT', added: true, expectedDesiredVersion: snapshotDesiredVersion });
      if (!persisted) await ensureCompensationScheduled(warRoomId);
      else {
        const afterPresent = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { desiredVersion: true } });
        if (afterPresent && afterPresent.desiredVersion !== snapshotDesiredVersion) await ensureCompensationScheduled(warRoomId);
      }
      continue;
    }
    if (!room.providerChannelId || !channelMembersByObjectId) {
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: 'CHANNEL_NOT_FOUND', message: 'The private Microsoft Teams channel is not available for participant sync.', expectedDesiredVersion: snapshotDesiredVersion });
      continue;
    }
    const channelMember = channelMembersByObjectId.get(userObjectId) ?? null;
    if (channelMember) {
      const persisted = await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'PRESENT', added: true, expectedDesiredVersion: snapshotDesiredVersion });
      if (!persisted) await ensureCompensationScheduled(warRoomId);
      else {
        const afterPresent = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { desiredVersion: true } });
        if (afterPresent && afterPresent.desiredVersion !== snapshotDesiredVersion) await ensureCompensationScheduled(warRoomId);
      }
      continue;
    }
    // Re-check authority and freshness before the mutating POST.
    const authorityBeforeAdd = await validateParticipantSyncAuthority(room);
    if (!authorityBeforeAdd.allowed) {
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: authorityBeforeAdd.code, message: authorityBeforeAdd.message, expectedDesiredVersion: snapshotDesiredVersion });
      continue;
    }
    const freshBeforeAdd = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { state: true, desiredVersion: true } });
    if (freshBeforeAdd?.state !== 'PENDING' || freshBeforeAdd.desiredVersion !== snapshotDesiredVersion) continue;
    const added = await addChannelMember({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId, userObjectId });
    if (!added.ok && added.code !== 'MEMBER_ALREADY_PRESENT') {
      throwIfRetryableMemberGraph(added);
      await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'FAILED', code: added.code, message: added.message, expectedDesiredVersion: snapshotDesiredVersion });
      continue;
    }
    const persisted = await persistParticipantOutcome({ id: snapshotParticipant.id, state: 'PRESENT', added: true, expectedDesiredVersion: snapshotDesiredVersion });
    if (!persisted) {
      // CAS fenced after provider side effect — we added a member who is now REMOVED. Compensate by scheduling immediate removal.
      await ensureCompensationScheduled(warRoomId);
      // Best-effort immediate compensation: if version bump indicates REMOVED, remove what we just added.
      const afterAdd = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { state: true, desiredVersion: true } });
      if (afterAdd?.state === 'REMOVED' && afterAdd.desiredVersion !== snapshotDesiredVersion) {
        // Fire an extra sync cycle already scheduled above; no inline DELETE to avoid double TOCTOU.
      }
    } else {
      const afterAdd = await prisma.warRoomParticipant.findUnique({ where: { id: snapshotParticipant.id }, select: { desiredVersion: true, state: true } });
      if (afterAdd && afterAdd.desiredVersion !== snapshotDesiredVersion && afterAdd.state === 'REMOVED') {
        await ensureCompensationScheduled(warRoomId);
      }
    }
    // Update local map
    // Do not synthesize a Graph membership ID; a later owner promotion must use a real Graph ID.
  }
}

/** Queues responder reconciliation for every active Teams room on an incident. */
export async function requestMicrosoftTeamsWarRoomParticipantSyncForIncident(incidentId: string): Promise<void> {
  const rooms = await prisma.incidentWarRoom.findMany({
    where: { incidentId, provider: 'MICROSOFT_TEAMS', state: 'READY' }, select: { id: true },
  });
  await Promise.all(rooms.map(room => scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId: room.id }, 5)));
}
