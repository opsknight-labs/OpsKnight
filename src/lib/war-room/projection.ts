import 'server-only';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { sendMicrosoftTeamsIncidentCard, updateMicrosoftTeamsIncidentCard } from '@/lib/microsoft-teams/client';
import { getBaseUrl } from '@/lib/env-validation';

const PROJECTION_LEASE_MS = 2 * 60_000;

/** Coalesces incident changes into one ordered, durable card-projection job. */
export async function requestMicrosoftTeamsWarRoomProjection(warRoomId: string): Promise<number | null> {
  return prisma.$transaction(async tx => {
    const changed = await tx.incidentWarRoom.updateMany({
      where: { id: warRoomId, provider: 'MICROSOFT_TEAMS', state: 'READY' },
      data: { projectionVersion: { increment: 1 } },
    });
    if (changed.count !== 1) return null;
    const room = await tx.incidentWarRoom.findUniqueOrThrow({ where: { id: warRoomId }, select: { projectionVersion: true } });
    await tx.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_PROJECT', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 5,
        payload: { warRoomId, projectionVersion: room.projectionVersion },
      },
    });
    return room.projectionVersion;
  });
}

/** Queues the latest canonical-card projection for every ready Teams room. */
export async function requestMicrosoftTeamsWarRoomProjectionForIncident(incidentId: string): Promise<void> {
  const rooms = await prisma.incidentWarRoom.findMany({
    where: { incidentId, provider: 'MICROSOFT_TEAMS', state: 'READY' },
    select: { id: true },
  });
  await Promise.all(rooms.map(room => requestMicrosoftTeamsWarRoomProjection(room.id)));
}

/** Claims a short lease. Older queued versions are intentionally no-ops. */
export async function claimMicrosoftTeamsWarRoomProjection(warRoomId: string, projectionVersion: number) {
  const token = crypto.randomUUID();
  const now = new Date();
  const changed = await prisma.incidentWarRoom.updateMany({
    where: {
      id: warRoomId, provider: 'MICROSOFT_TEAMS', state: 'READY', projectionVersion,
      OR: [{ projectionLeaseExpiresAt: null }, { projectionLeaseExpiresAt: { lte: now } }],
    },
    data: { projectionLeaseToken: token, projectionLeaseExpiresAt: new Date(now.getTime() + PROJECTION_LEASE_MS) },
  });
  return changed.count === 1 ? token : null;
}

export async function completeMicrosoftTeamsWarRoomProjection(warRoomId: string, projectionVersion: number, token: string): Promise<boolean> {
  const changed = await prisma.incidentWarRoom.updateMany({
    where: { id: warRoomId, projectionVersion, projectionLeaseToken: token },
    data: { lastProjectedAt: new Date(), projectionLeaseToken: null, projectionLeaseExpiresAt: null },
  });
  return changed.count === 1;
}

/** Projects one canonical Teams command card; stale versions are no-ops. */
export async function projectMicrosoftTeamsWarRoomCard(warRoomId: string, projectionVersion: number): Promise<void> {
  const token = await claimMicrosoftTeamsWarRoomProjection(warRoomId, projectionVersion);
  if (!token) return;
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
  });
  if (!room?.destinationId || !room.providerTenantId || !room.providerContainerId || !room.providerChannelId) return;
  const incidentRecord = await prisma.incident.findUnique({
    where: { id: room.incidentId },
    include: { service: { select: { name: true } }, assignee: { select: { name: true } } },
  });
  if (!incidentRecord) return;
  const incident = {
    id: incidentRecord.id, title: incidentRecord.title, description: incidentRecord.description,
    status: incidentRecord.status, urgency: incidentRecord.urgency, priority: incidentRecord.priority,
    serviceName: incidentRecord.service.name, assigneeName: incidentRecord.assignee?.name,
    incidentUrl: `${getBaseUrl().replace(/\/+$/, '')}/incidents/${incidentRecord.id}`,
    createdAt: incidentRecord.createdAt, acknowledgedAt: incidentRecord.acknowledgedAt, resolvedAt: incidentRecord.resolvedAt,
  };
  const eventType = incidentRecord.status === 'RESOLVED' ? 'resolved' as const : incidentRecord.acknowledgedAt ? 'acknowledged' as const : 'triggered' as const;
  const interactive = { destinationId: room.destinationId, messageGeneration: room.messageGeneration, warRoomId: room.id };
  if (!room.commandMessageId) {
    // A lost response after POST is ambiguous. Never create a second canonical card.
    const attempted = await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token, commandMessageId: null, commandCreateAttemptedAt: null },
      data: { commandCreateAttemptedAt: new Date() },
    });
    if (attempted.count !== 1) return;
    const created = await sendMicrosoftTeamsIncidentCard({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId, incident, eventType, disableActions: eventType === 'resolved', interactive });
    if (!created.success || !created.providerMessageId || !created.conversationId) {
      await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { health: 'DEGRADED', lastErrorCode: created.success ? 'AMBIGUOUS_CARD_CREATE' : created.errorCode ?? 'CARD_CREATE_FAILED', lastError: created.success ? 'Teams returned an incomplete command-card reference.' : created.error } });
      return;
    }
    await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { commandMessageId: created.providerMessageId, commandConversationId: created.conversationId } });
  } else {
    const updated = await updateMicrosoftTeamsIncidentCard({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId, messageId: room.commandMessageId, conversationId: room.commandConversationId, incident, eventType, disableActions: eventType === 'resolved', interactive });
    if (!updated.success) {
      await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { health: 'DEGRADED', lastErrorCode: updated.errorCode ?? 'CARD_UPDATE_FAILED', lastError: updated.error } });
      return;
    }
  }
  await completeMicrosoftTeamsWarRoomProjection(room.id, projectionVersion, token);
}
