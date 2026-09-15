import type { ChatProvider, WarRoomParticipantSource } from '@prisma/client';
import prisma from '@/lib/prisma';

type DesiredResponder = { userId: string; source: WarRoomParticipantSource };

async function replaceDesiredParticipants(
  warRoomId: string,
  provider: ChatProvider,
  providerTenantId: string,
  responders: readonly DesiredResponder[]
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
  const identityByUser = new Map(identities.map(identity => [identity.userId, identity]));
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
      incident: { select: { assigneeId: true, watchers: { select: { userId: true } } } },
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
    [...responders].map(([userId, source]) => ({ userId, source }))
  );
}

export async function requestWarRoomParticipant(
  warRoomId: string,
  userId: string,
  source: WarRoomParticipantSource
): Promise<{ accepted: boolean; code?: string }> {
  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId } });
  if (!room?.providerTenantId || room.state !== 'READY') {
    return { accepted: false, code: 'WAR_ROOM_NOT_READY' };
  }
  const identity = await prisma.chatIdentityLink.findFirst({
    where: {
      provider: room.provider,
      providerTenantId: room.providerTenantId,
      userId,
      revokedAt: null,
    },
    select: { providerUserId: true, providerObjectId: true },
  });
  const providerObjectId = identity?.providerObjectId ?? identity?.providerUserId ?? null;
  if (!identity || !providerObjectId) return { accepted: false, code: 'IDENTITY_NOT_LINKED' };

  await prisma.$transaction(async tx => {
    const existing = await tx.warRoomParticipant.findFirst({ where: { warRoomId, userId } });
    const data = {
      source,
      providerUserId: identity.providerUserId,
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
