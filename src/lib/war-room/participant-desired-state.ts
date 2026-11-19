import type { ChatProvider, WarRoomParticipantSource } from '@prisma/client';
import prisma from '@/lib/prisma';

type DesiredResponder = { userId: string; source: WarRoomParticipantSource };

/**
 * Slack has no account-link flow, so unlinked users are matched to Slack members
 * by verified account email (users.lookupByEmail, `users:read.email` scope) —
 * the same email trust the Slack action handlers already use for attribution.
 */
async function resolveSlackUsersByEmail(
  serviceId: string,
  userIds: readonly string[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (userIds.length === 0) return resolved;
  const { getSlackBotToken } = await import('@/lib/slack');
  const token = await getSlackBotToken(serviceId);
  if (!token) return resolved;
  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] }, status: 'ACTIVE' },
    select: { id: true, email: true },
  });
  for (const user of users) {
    if (!user.email) continue;
    try {
      const res = await fetch(
        `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(user.email)}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) }
      );
      const data = (await res.json()) as { ok?: boolean; user?: { id?: string; deleted?: boolean } };
      if (data.ok && data.user?.id && !data.user.deleted) resolved.set(user.id, data.user.id);
    } catch {
      // Unresolved users are recorded as IDENTITY_NOT_LINKED and retried on the next projection.
    }
  }
  return resolved;
}

async function replaceDesiredParticipants(
  warRoomId: string,
  provider: ChatProvider,
  providerTenantId: string,
  responders: readonly DesiredResponder[],
  serviceId: string
): Promise<void> {
  const byUser = new Map(responders.map(responder => [responder.userId, responder.source]));
  const userIds = [...byUser.keys()];
  const identities =
    userIds.length === 0
      ? []
      : await prisma.chatIdentityLink.findMany({
          where: {
            provider,
            providerTenantId,
            revokedAt: null,
            userId: { in: userIds },
          },
          select: { userId: true, providerUserId: true, providerObjectId: true },
        });
  const identityByUser = new Map<
    string,
    { providerUserId: string | null; providerObjectId: string | null }
  >(identities.map(identity => [identity.userId, identity]));
  if (provider === 'SLACK') {
    const unlinked = userIds.filter(userId => !identityByUser.has(userId));
    for (const [userId, slackUserId] of await resolveSlackUsersByEmail(serviceId, unlinked)) {
      identityByUser.set(userId, { providerUserId: slackUserId, providerObjectId: null });
    }
  }
  const now = new Date();

  await prisma.$transaction(async tx => {
    await tx.warRoomParticipant.updateMany({
      where: {
        warRoomId,
        ...(userIds.length ? { userId: { notIn: userIds } } : {}),
        state: { in: ['DESIRED', 'PROCESSING', 'PENDING', 'PRESENT', 'FAILED'] },
      },
      data: {
        state: 'REMOVED',
        desiredVersion: { increment: 1 },
        lastSyncAt: now,
        lastError: null,
        lastErrorCode: null,
      },
    });

    for (const [userId, source] of byUser) {
      const identity = identityByUser.get(userId);
      const providerObjectId = identity?.providerObjectId ?? identity?.providerUserId ?? null;
      const desiredState = providerObjectId ? ('DESIRED' as const) : ('SKIPPED' as const);
      const existing = await tx.warRoomParticipant.findFirst({ where: { warRoomId, userId } });
      const data = {
        source,
        providerUserId: identity?.providerUserId ?? null,
        providerObjectId,
        state: desiredState,
        lastErrorCode: providerObjectId ? null : 'IDENTITY_NOT_LINKED',
        lastError: providerObjectId ? null : 'IDENTITY_NOT_LINKED',
      };
      if (!existing) {
        await tx.warRoomParticipant.create({
          data: { warRoomId, userId, desiredVersion: 1, ...data },
        });
        continue;
      }
      const changed =
        existing.source !== source ||
        existing.providerUserId !== data.providerUserId ||
        existing.providerObjectId !== providerObjectId ||
        existing.state === 'REMOVED' ||
        existing.state === 'SKIPPED';
      await tx.warRoomParticipant.update({
        where: { id: existing.id },
        data: { ...data, ...(changed ? { desiredVersion: { increment: 1 } } : {}) },
      });
    }
  });
}

export async function projectIncidentWarRoomParticipants(warRoomId: string): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: {
      incident: {
        select: { serviceId: true, assigneeId: true, watchers: { select: { userId: true } } },
      },
    },
  });
  if (!room?.providerTenantId || !['SLACK', 'MICROSOFT_TEAMS'].includes(room.provider)) return;

  const responders = new Map<string, WarRoomParticipantSource>();
  if (room.incident.assigneeId) responders.set(room.incident.assigneeId, 'ASSIGNEE');
  for (const watcher of room.incident.watchers) {
    if (!responders.has(watcher.userId)) responders.set(watcher.userId, 'WATCHER');
  }
  await replaceDesiredParticipants(
    room.id,
    room.provider,
    room.providerTenantId,
    [...responders].map(([userId, source]) => ({ userId, source })),
    room.incident.serviceId
  );
}

export async function requestWarRoomParticipant(
  warRoomId: string,
  userId: string,
  source: WarRoomParticipantSource
): Promise<{ accepted: boolean; code?: string }> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: { incident: { select: { serviceId: true } } },
  });
  if (!room?.providerTenantId || room.state !== 'READY') {
    return { accepted: false, code: 'WAR_ROOM_NOT_READY' };
  }
  let identity: { providerUserId: string | null; providerObjectId: string | null } | null =
    await prisma.chatIdentityLink.findFirst({
      where: {
        provider: room.provider,
        providerTenantId: room.providerTenantId,
        userId,
        revokedAt: null,
      },
      select: { providerUserId: true, providerObjectId: true },
    });
  if (!identity && room.provider === 'SLACK') {
    const slackUserId = (await resolveSlackUsersByEmail(room.incident.serviceId, [userId])).get(
      userId
    );
    if (slackUserId) identity = { providerUserId: slackUserId, providerObjectId: null };
  }
  const providerObjectId = identity?.providerObjectId ?? identity?.providerUserId ?? null;
  if (!identity || !providerObjectId) return { accepted: false, code: 'IDENTITY_NOT_LINKED' };
  const providerUserId = identity.providerUserId;

  await prisma.$transaction(async tx => {
    const existing = await tx.warRoomParticipant.findFirst({ where: { warRoomId, userId } });
    const data = {
      source,
      providerUserId,
      providerObjectId,
      state: 'DESIRED' as const,
      lastError: null,
      lastErrorCode: null,
    };
    if (existing) {
      await tx.warRoomParticipant.update({
        where: { id: existing.id },
        data: { ...data, desiredVersion: { increment: 1 } },
      });
    } else {
      await tx.warRoomParticipant.create({
        data: { warRoomId, userId, desiredVersion: 1, ...data },
      });
    }
    await tx.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_PARTICIPANT_SYNC',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 5,
        payload: { warRoomId },
      },
    });
  });
  return { accepted: true };
}
