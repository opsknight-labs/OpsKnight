import 'server-only';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { sendMicrosoftTeamsIncidentCard, updateMicrosoftTeamsIncidentCard } from '@/lib/microsoft-teams/client';
import { getBaseUrl } from '@/lib/env-validation';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { WarRoomRetryableError } from './microsoft-teams';

const PROJECTION_LEASE_MS = 2 * 60_000;

function isRetryableTeamsProjectionError(result: { errorCode?: string; statusCode?: number; error: string }): boolean {
  const code = (result.errorCode ?? '').toUpperCase();
  if (code === 'RATE_LIMITED' || code === 'GRAPH_TOKEN_FAILED' || code === 'TRANSIENT_READ') return true;
  if (code === 'AMBIGUOUS_SIDE_EFFECT' || code === 'AMBIGUOUS_CARD_CREATE') return false;
  if (result.statusCode != null && result.statusCode >= 500 && result.statusCode <= 599) return true;
  if (result.statusCode === 429) return true;
  if (/^http_5\d{2}$/i.test(code)) return true;
  return false;
}

function isAmbiguousCardCreateResult(result: { errorCode?: string; success: boolean; providerMessageId?: string; conversationId?: string }): boolean {
  if (!result.success && result.errorCode === 'AMBIGUOUS_SIDE_EFFECT') return true;
  if (result.success && (!result.providerMessageId || !result.conversationId)) return true;
  return false;
}

/** Coalesces incident changes into one ordered, durable card-projection job. */
export async function requestMicrosoftTeamsWarRoomProjection(warRoomId: string): Promise<number | null> {
  return prisma.$transaction(async tx => {
    const changed = await tx.incidentWarRoom.updateMany({
      where: { id: warRoomId, provider: 'MICROSOFT_TEAMS', state: { in: ['READY', 'CLOSING'] } },
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
      id: warRoomId, provider: 'MICROSOFT_TEAMS', state: { in: ['READY', 'CLOSING'] }, projectionVersion,
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
  if (changed.count === 1) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: warRoomId, projectionVersion, state: 'CLOSING', projectionLeaseToken: null },
      data: { state: 'CLOSED', closedAt: new Date() },
    });
  }
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

  // Authority must be checked before any Graph side effect, so a destination/
  // integration that was revoked while this job was queued cannot leak an update.
  const authority = await validateWarRoomCollaborationAuthority(room);
  if (!authority.allowed) {
    addOperationalMetric('opsknight_war_room_projection_total', 1, { provider: 'MICROSOFT_TEAMS', result: 'authority_revoked' });
    // Mark degraded but still release the lease so the CLOSING -> CLOSED transition
    // can proceed away from the authority check once resolved separately.
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: { health: 'DEGRADED', lastErrorCode: authority.code, lastError: authority.message },
    });
    // Do not throw: authority revocation is terminal for this generation, not a transient retry.
    // Release lease without CLOSED promotion; caller will decide completion.
    await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null } });
    return;
  }

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
    // Use the durable pre-POST hook so only a real network attempt marks the
    // canonical create as attempted. A token/serviceUrl failure before the POST
    // must remain retryable; an ambiguous POST must never be retried.
    const created = await sendMicrosoftTeamsIncidentCard({
      tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId,
      incident, eventType, disableActions: eventType === 'resolved', interactive,
      beforeCreateAttempt: async () => {
        const marked = await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, projectionLeaseToken: token, commandMessageId: null, commandCreateAttemptedAt: null },
          data: { commandCreateAttemptedAt: new Date() },
        });
        if (marked.count !== 1) throw new Error('CANONICAL_CARD_CREATE_FENCED');
      },
    });
    if (isAmbiguousCardCreateResult(created as never)) {
      addOperationalMetric('opsknight_war_room_projection_total', 1, { provider: 'MICROSOFT_TEAMS', result: 'ambiguous' });
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: { health: 'DEGRADED', lastErrorCode: 'AMBIGUOUS_CARD_CREATE', lastError: created.success ? 'Teams returned an incomplete command-card reference.' : (created as { error: string }).error },
      });
      // Ambiguous POST must never be auto-retried blindly.
      await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null } });
      return;
    }
    if (!created.success || !created.providerMessageId || !created.conversationId) {
      const retryable = isRetryableTeamsProjectionError(created as never);
      addOperationalMetric('opsknight_war_room_projection_total', 1, { provider: 'MICROSOFT_TEAMS', result: retryable ? 'retryable' : 'failed' });
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: { health: 'DEGRADED', lastErrorCode: (created as { errorCode?: string }).errorCode ?? 'CARD_CREATE_FAILED', lastError: (created as { error: string }).error },
      });
      // For retryable cases, release lease partially and throw through the queue's retry path.
      // We must still clear the pre-attempt marker if it was set but no POST occurred.
      // The beforeCreateAttempt hook only marks when POST is about to happen; for early
      // failures (token/serviceUrl), the marker remains null and remains retryable.
      // For POST 5xx/429 we keep DEGRADED but allow retry via exception.
      if (retryable) {
        // Check if we set commandCreateAttemptedAt but actually had a retryable POST failure —
        // distinguish by whether we reached the hook. If hook threw FENCED, we are stale.
        // Otherwise, if errorCode indicates POST reached network and failed retryably,
        // the marker is already set correctly (ambiguous vs retryable boundary handled above).
        // For clean re-queue, release lease without completing.
        await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null } });
        throw new WarRoomRetryableError((created as { error: string }).error, (created as { retryAfterMs?: number }).retryAfterMs);
      }
      await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null } });
      return;
    }
    await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { commandMessageId: created.providerMessageId, commandConversationId: created.conversationId, health: 'HEALTHY', lastError: null, lastErrorCode: null } });
  } else {
    const updated = await updateMicrosoftTeamsIncidentCard({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId, messageId: room.commandMessageId, conversationId: room.commandConversationId, incident, eventType, disableActions: eventType === 'resolved', interactive });
    if (!updated.success) {
      const retryable = isRetryableTeamsProjectionError(updated as never);
      addOperationalMetric('opsknight_war_room_projection_total', 1, { provider: 'MICROSOFT_TEAMS', result: retryable ? 'retryable' : 'failed' });
      await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { health: 'DEGRADED', lastErrorCode: updated.errorCode ?? 'CARD_UPDATE_FAILED', lastError: updated.error } });
      if (retryable) {
        await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null } });
        throw new WarRoomRetryableError(updated.error, updated.retryAfterMs);
      }
      await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null } });
      return;
    }
    // Successful update clears health degradation.
    await prisma.incidentWarRoom.updateMany({ where: { id: room.id, projectionLeaseToken: token }, data: { health: 'HEALTHY', lastError: null, lastErrorCode: null } });
  }
  await completeMicrosoftTeamsWarRoomProjection(room.id, projectionVersion, token);
  addOperationalMetric('opsknight_war_room_projection_total', 1, { provider: 'MICROSOFT_TEAMS', result: 'success' });
}

async function validateWarRoomCollaborationAuthority(room: {
  destinationId: string | null;
  installationId: string | null;
  providerTenantId: string | null;
  providerContainerId: string | null;
  state: string;
}): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
  if (!room.destinationId) return { allowed: false, code: 'DESTINATION_SNAPSHOT_MISSING', message: 'War-room routing snapshot is missing.' };
  if (room.state !== 'READY' && room.state !== 'CLOSING') return { allowed: false, code: 'WAR_ROOM_STATE_INVALID', message: `War-room state ${room.state} does not permit projection.` };
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
