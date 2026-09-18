import 'server-only';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import {
  sendMicrosoftTeamsIncidentCard,
  updateMicrosoftTeamsIncidentCard,
} from '@/lib/microsoft-teams/client';
import { getBaseUrl } from '@/lib/env-validation';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { WarRoomRetryableError } from '../../errors';
import { buildWarRoomProjection } from '../../projection-model';

const PROJECTION_LEASE_MS = 2 * 60_000;

function isRetryableTeamsProjectionError(result: {
  errorCode?: string;
  statusCode?: number;
  error: string;
}): boolean {
  const code = (result.errorCode ?? '').toUpperCase();
  if (code === 'RATE_LIMITED' || code === 'GRAPH_TOKEN_FAILED' || code === 'TRANSIENT_READ')
    return true;
  if (code === 'AMBIGUOUS_SIDE_EFFECT' || code === 'AMBIGUOUS_CARD_CREATE') return false;
  // BotNotInConversationRoster indicates the bot cannot participate in the channel roster; retries cannot succeed.
  if (
    result.error &&
    (result.error.includes('BotNotInConversationRoster') ||
      result.error.includes('The bot is not part of the conversation roster'))
  ) {
    return false;
  }
  if (result.statusCode != null && result.statusCode >= 500 && result.statusCode <= 599)
    return true;
  if (result.statusCode === 429) return true;
  if ([401, 403, 404].includes(result.statusCode ?? 0)) return true;
  if (['HTTP_401', 'HTTP_403', 'HTTP_404'].includes(code)) return true;
  if (/^http_5\d{2}$/i.test(code)) return true;
  return false;
}

/** Definite pre-side-effect rejections are safe to retry after clearing the marker. */
function isDefiniteCreateRetryableError(result: {
  errorCode?: string;
  statusCode?: number;
  error?: string;
}): boolean {
  if (
    result.error &&
    (result.error.includes('BotNotInConversationRoster') ||
      result.error.includes('The bot is not part of the conversation roster'))
  ) {
    return false;
  }
  const code = (result.errorCode ?? '').toUpperCase();
  if (code === 'RATE_LIMITED') return true;
  if (result.statusCode === 429) return true;
  // Authentication, authorization, and routing rejection means Graph did not
  // accept the POST, so no canonical card could have been created.
  if ([401, 403, 404].includes(result.statusCode ?? 0)) return true;
  if (['HTTP_401', 'HTTP_403', 'HTTP_404'].includes(code)) return true;
  // Token acquisition happens before the POST; no side effect could have been created.
  if (code === 'GRAPH_TOKEN_FAILED' || code === 'TRANSIENT_READ') return true;
  return false;
}

function isAmbiguousCardCreateResult(result: {
  errorCode?: string;
  success: boolean;
  providerMessageId?: string;
  conversationId?: string;
}): boolean {
  if (!result.success && result.errorCode === 'AMBIGUOUS_SIDE_EFFECT') return true;
  if (result.success && (!result.providerMessageId || !result.conversationId)) return true;
  return false;
}

/**
 * Terminal settlement for WAR_ROOM_PROJECT jobs whose retry budget is
 * exhausted while the room is in CLOSING state. Clears leases and closes
 * locally so the room never hangs in CLOSING forever.
 */
export async function settleWarRoomProjectionFailure(
  warRoomId: string,
  projectionVersion: number
): Promise<void> {
  // Subordinate to close lifecycle: never CLOSING→CLOSED here.
  const changed = await prisma.incidentWarRoom.updateMany({
    where: { id: warRoomId, projectionVersion, state: 'CLOSING' },
    data: {
      health: 'DEGRADED',
      lastErrorCode: 'PROJECTION_RETRIES_EXHAUSTED',
      lastError:
        'War-room card projection exhausted its retry budget while closing; awaiting close lifecycle decision.',
      projectionLeaseToken: null,
      projectionLeaseExpiresAt: null,
    },
  });
  if (changed.count === 0) {
    // Even when already CLOSED or not CLOSING, clear a stale lease for this version.
    await prisma.incidentWarRoom.updateMany({
      where: { id: warRoomId, projectionVersion, projectionLeaseToken: { not: null } },
      data: {
        projectionLeaseToken: null,
        projectionLeaseExpiresAt: null,
        health: 'DEGRADED',
        lastErrorCode: 'PROJECTION_RETRIES_EXHAUSTED',
        lastError: 'War-room projection exhausted its retry budget; health marked degraded.',
      },
    });
  }
}

/** Coalesces incident changes into one ordered, durable card-projection job. */
export async function requestMicrosoftTeamsWarRoomProjection(
  warRoomId: string
): Promise<number | null> {
  return prisma.$transaction(async tx => {
    const changed = await tx.incidentWarRoom.updateMany({
      where: { id: warRoomId, provider: 'MICROSOFT_TEAMS', state: { in: ['READY', 'CLOSING'] } },
      data: { projectionVersion: { increment: 1 } },
    });
    if (changed.count !== 1) return null;
    const room = await tx.incidentWarRoom.findUniqueOrThrow({
      where: { id: warRoomId },
      select: { projectionVersion: true },
    });
    await tx.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_PROJECT',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 5,
        payload: { warRoomId, projectionVersion: room.projectionVersion },
      },
    });
    return room.projectionVersion;
  });
}

/** Queues the latest canonical-card projection for every ready Teams room. */
export async function requestMicrosoftTeamsWarRoomProjectionForIncident(
  incidentId: string
): Promise<void> {
  const rooms = await prisma.incidentWarRoom.findMany({
    where: { incidentId, provider: 'MICROSOFT_TEAMS', state: 'READY' },
    select: { id: true },
  });
  await Promise.all(rooms.map(room => requestMicrosoftTeamsWarRoomProjection(room.id)));
}

/** Claims a short lease. Older queued versions are intentionally no-ops. */
export async function claimMicrosoftTeamsWarRoomProjection(
  warRoomId: string,
  projectionVersion: number
) {
  const token = crypto.randomUUID();
  const now = new Date();
  const changed = await prisma.incidentWarRoom.updateMany({
    where: {
      id: warRoomId,
      provider: 'MICROSOFT_TEAMS',
      state: { in: ['READY', 'CLOSING'] },
      projectionVersion,
      OR: [{ projectionLeaseExpiresAt: null }, { projectionLeaseExpiresAt: { lte: now } }],
    },
    data: {
      projectionLeaseToken: token,
      projectionLeaseExpiresAt: new Date(now.getTime() + PROJECTION_LEASE_MS),
    },
  });
  return changed.count === 1 ? token : null;
}

export async function completeMicrosoftTeamsWarRoomProjection(
  warRoomId: string,
  projectionVersion: number,
  token: string
): Promise<boolean> {
  const changed = await prisma.incidentWarRoom.updateMany({
    where: { id: warRoomId, projectionVersion, projectionLeaseToken: token },
    data: {
      lastProjectedVersion: projectionVersion,
      lastProjectedAt: new Date(),
      projectionLeaseToken: null,
      projectionLeaseExpiresAt: null,
    },
  });
  // Do not transition CLOSING→CLOSED here; close lifecycle owns terminal state.
  return changed.count === 1;
}

/** Projects one canonical Teams command card; stale versions are no-ops. */
export async function projectMicrosoftTeamsWarRoomCard(
  warRoomId: string,
  projectionVersion: number
): Promise<void> {
  const token = await claimMicrosoftTeamsWarRoomProjection(warRoomId, projectionVersion);
  if (!token) return;
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
  });
  if (
    !room?.destinationId ||
    !room.providerTenantId ||
    !room.providerContainerId ||
    !room.providerChannelId
  ) {
    if (!room) return;
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: {
        health: 'DEGRADED',
        lastErrorCode: 'WAR_ROOM_ROUTING_MISSING',
        lastError:
          'War-room routing snapshot was missing during terminal projection; close lifecycle owns final state.',
        projectionLeaseToken: null,
        projectionLeaseExpiresAt: null,
      },
    });
    return;
  }

  // Authority must be checked before any Graph side effect, so a destination/
  // integration that was revoked while this job was queued cannot leak an update.
  const authority = await validateWarRoomCollaborationAuthority(room);
  if (!authority.allowed) {
    addOperationalMetric('opsknight_war_room_projection_total', 1, {
      provider: 'MICROSOFT_TEAMS',
      result: 'authority_revoked',
    });
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: {
        health: 'DEGRADED',
        lastErrorCode: authority.code,
        lastError: authority.message,
        projectionLeaseToken: null,
        projectionLeaseExpiresAt: null,
      },
    });
    return;
  }

  const incidentRecord = await prisma.incident.findUnique({
    where: { id: room.incidentId },
    include: { service: { select: { name: true } }, assignee: { select: { name: true } } },
  });
  if (!incidentRecord) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: {
        health: 'DEGRADED',
        lastErrorCode: 'INCIDENT_NOT_FOUND',
        lastError:
          'Incident no longer exists during terminal projection; close lifecycle owns final state.',
        projectionLeaseToken: null,
        projectionLeaseExpiresAt: null,
      },
    });
    return;
  }
  // P1-1: single runtime path WAR_ROOM_PROJECT → buildWarRoomProjection → renderer → transport.
  // Shared channel card is fail-closed: no privileged actions, only View Incident + refresh.
  const sharedCapFailClosed = {
    canAcknowledge: false,
    canResolve: false,
    canAssignSelf: false,
    canAddNote: false,
    canSetPriority: false,
    canSnooze: false,
    canEscalate: false,
    canJoinResponder: false,
    canRead: false,
  } as const;
  const { getIncidentMeeting } = await import('@/lib/incident-collaboration/meeting-store');
  const activeMeeting = await getIncidentMeeting(incidentRecord.id).catch(() => null);
  const meetingProjection =
    activeMeeting?.state === 'READY' && activeMeeting.joinUrl
      ? {
          provider: activeMeeting.provider,
          joinUrl: activeMeeting.joinUrl,
          joinWebUrl: activeMeeting.joinWebUrl,
          conferenceId: activeMeeting.conferenceId,
          tollNumber: activeMeeting.tollNumber,
        }
      : null;

  const model = buildWarRoomProjection(
    {
      id: incidentRecord.id,
      title: incidentRecord.title,
      description: incidentRecord.description,
      status: incidentRecord.status,
      urgency: incidentRecord.urgency,
      priority: incidentRecord.priority,
      serviceName: incidentRecord.service.name,
      assigneeName: incidentRecord.assignee?.name ?? null,
      url: `${getBaseUrl().replace(/\/+$/, '')}/incidents/${incidentRecord.id}`,
      createdAt: incidentRecord.createdAt,
      acknowledgedAt: incidentRecord.acknowledgedAt,
      resolvedAt: incidentRecord.resolvedAt,
    },
    { capabilities: sharedCapFailClosed, meeting: meetingProjection }
  );
  // eventType derived from canonical phase — model.phase is the single source of truth.
  const eventType =
    model.phase === 'RESOLVED'
      ? ('resolved' as const)
      : model.phase === 'ACKNOWLEDGED'
        ? ('acknowledged' as const)
        : ('triggered' as const);
  // incident shape expected by sendMicrosoftTeamsIncidentCard transport layer
  const incident = {
    id: incidentRecord.id,
    title: incidentRecord.title,
    description: incidentRecord.description,
    status: incidentRecord.status,
    urgency: incidentRecord.urgency,
    priority: incidentRecord.priority,
    serviceName: incidentRecord.service.name,
    assigneeName: incidentRecord.assignee?.name,
    incidentUrl: model.incident.url,
    createdAt: incidentRecord.createdAt,
    acknowledgedAt: incidentRecord.acknowledgedAt,
    resolvedAt: incidentRecord.resolvedAt,
  };
  const interactive = {
    destinationId: room.destinationId,
    messageGeneration: room.messageGeneration,
    warRoomId: room.id,
    // Explicit fail-closed capabilities so the card builder does not fall back to allow-all.
    capabilities: sharedCapFailClosed as unknown as never,
  };
  if (!room.commandMessageId) {
    // Use the durable pre-POST hook so only a real network attempt marks the
    // canonical create as attempted. A token/serviceUrl failure before the POST
    // must remain retryable; an ambiguous POST must never be retried.
    let created: Awaited<ReturnType<typeof sendMicrosoftTeamsIncidentCard>>;
    try {
      created = await sendMicrosoftTeamsIncidentCard({
        tenantId: room.providerTenantId,
        teamId: room.providerContainerId,
        channelId: room.providerChannelId,
        incident,
        eventType,
        disableActions: eventType === 'resolved',
        meeting: meetingProjection,
        interactive,
        beforeCreateAttempt: async () => {
          const marked = await prisma.incidentWarRoom.updateMany({
            where: {
              id: room.id,
              projectionLeaseToken: token,
              commandMessageId: null,
              commandCreateAttemptedAt: null,
            },
            data: { commandCreateAttemptedAt: new Date() },
          });
          if (marked.count !== 1) throw new Error('CANONICAL_CARD_CREATE_FENCED');
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CANONICAL_CARD_CREATE_FENCED') {
        // Stale lease or a concurrent worker already armed the marker — do not
        // retry; the next projection generation owns the card.
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, projectionLeaseToken: token },
          data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
        });
        return;
      }
      throw error;
    }
    if (isAmbiguousCardCreateResult(created as never)) {
      addOperationalMetric('opsknight_war_room_projection_total', 1, {
        provider: 'MICROSOFT_TEAMS',
        result: 'ambiguous',
      });
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: {
          health: 'DEGRADED',
          lastErrorCode: 'AMBIGUOUS_CARD_CREATE',
          lastError: created.success
            ? 'Teams returned an incomplete command-card reference.'
            : (created as { error: string }).error,
        },
      });
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
      });
      return;
    }
    if (!created.success || !created.providerMessageId || !created.conversationId) {
      const retryable = isRetryableTeamsProjectionError(created as never);
      const definite = isDefiniteCreateRetryableError(created as never);
      addOperationalMetric('opsknight_war_room_projection_total', 1, {
        provider: 'MICROSOFT_TEAMS',
        result: retryable ? 'retryable' : 'failed',
      });
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: {
          health: 'DEGRADED',
          lastErrorCode: (created as { errorCode?: string }).errorCode ?? 'CARD_CREATE_FAILED',
          lastError: (created as { error: string }).error,
        },
      });
      if (definite) {
        // Definite rejection before any side effect was created (429 / RATE_LIMITED
        // or token acquisition before the POST). Clear the pre-POST marker under
        // the same lease so the next retry can re-arm the hook.
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, projectionLeaseToken: token },
          data: {
            commandCreateAttemptedAt: null,
            projectionLeaseToken: null,
            projectionLeaseExpiresAt: null,
          },
        });
        throw new WarRoomRetryableError(
          (created as { error: string }).error,
          (created as { retryAfterMs?: number }).retryAfterMs
        );
      }
      if (retryable) {
        // Uncertain outcome (5xx / timeout) — the POST may have mutating side
        // effect. Keep commandCreateAttemptedAt set so the next worker never
        // blindly re-POSTs; reconciliationOnly path must be used.
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, projectionLeaseToken: token },
          data: {
            health: 'DEGRADED',
            lastErrorCode: 'AMBIGUOUS_CARD_CREATE',
            lastError: (created as { error: string }).error,
          },
        });
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, projectionLeaseToken: token },
          data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
        });
        return;
      }
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
      });
      return;
    }
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: {
        commandMessageId: created.providerMessageId,
        commandConversationId: created.conversationId,
        health: 'HEALTHY',
        lastError: null,
        lastErrorCode: null,
      },
    });
  } else {
    const updated = await updateMicrosoftTeamsIncidentCard({
      tenantId: room.providerTenantId,
      teamId: room.providerContainerId,
      channelId: room.providerChannelId,
      messageId: room.commandMessageId,
      conversationId: room.commandConversationId,
      incident,
      eventType,
      disableActions: eventType === 'resolved',
      meeting: meetingProjection,
      interactive,
    });
    if (!updated.success) {
      const retryable = isRetryableTeamsProjectionError(updated as never);
      addOperationalMetric('opsknight_war_room_projection_total', 1, {
        provider: 'MICROSOFT_TEAMS',
        result: retryable ? 'retryable' : 'failed',
      });
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: {
          health: 'DEGRADED',
          lastErrorCode: updated.errorCode ?? 'CARD_UPDATE_FAILED',
          lastError: updated.error,
        },
      });
      if (retryable) {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, projectionLeaseToken: token },
          data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
        });
        throw new WarRoomRetryableError(updated.error, updated.retryAfterMs);
      }
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
      });
      return;
    }
    // Successful update clears health degradation.
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: { health: 'HEALTHY', lastError: null, lastErrorCode: null },
    });
  }
  await completeMicrosoftTeamsWarRoomProjection(room.id, projectionVersion, token);
  addOperationalMetric('opsknight_war_room_projection_total', 1, {
    provider: 'MICROSOFT_TEAMS',
    result: 'success',
  });
}

async function validateWarRoomCollaborationAuthority(room: {
  destinationId: string | null;
  installationId: string | null;
  providerTenantId: string | null;
  providerContainerId: string | null;
  state: string;
}): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
  if (!room.destinationId)
    return {
      allowed: false,
      code: 'DESTINATION_SNAPSHOT_MISSING',
      message: 'War-room routing snapshot is missing.',
    };
  if (room.state !== 'READY' && room.state !== 'CLOSING')
    return {
      allowed: false,
      code: 'WAR_ROOM_STATE_INVALID',
      message: `War-room state ${room.state} does not permit projection.`,
    };
  const [config, destination, installation] = await Promise.all([
    prisma.microsoftTeamsConfig.findFirst({
      where: { enabled: true, warRoomsEnabled: true },
      select: { id: true },
    }),
    prisma.microsoftTeamsDestination.findUnique({
      where: { id: room.destinationId },
      select: {
        enabled: true,
        warRoomEnabled: true,
        installationId: true,
        tenantId: true,
        teamId: true,
      },
    }),
    room.installationId
      ? prisma.microsoftTeamsInstallation.findUnique({
          where: { id: room.installationId },
          select: { enabled: true },
        })
      : Promise.resolve(null),
  ]);
  if (!config)
    return {
      allowed: false,
      code: 'WAR_ROOM_AUTHORITY_REVOKED',
      message: 'Microsoft Teams war-room configuration was disabled.',
    };
  if (!destination?.enabled || !destination.warRoomEnabled)
    return {
      allowed: false,
      code: 'WAR_ROOM_DESTINATION_REVOKED',
      message: 'Microsoft Teams war-room destination was disabled.',
    };
  if (
    room.installationId &&
    (!installation?.enabled || destination.installationId !== room.installationId)
  )
    return {
      allowed: false,
      code: 'WAR_ROOM_INSTALLATION_REVOKED',
      message: 'Microsoft Teams installation was disabled.',
    };
  if (room.providerTenantId && destination.tenantId !== room.providerTenantId)
    return {
      allowed: false,
      code: 'WAR_ROOM_TENANT_MISMATCH',
      message: 'War-room tenant no longer matches its destination.',
    };
  if (room.providerContainerId && destination.teamId !== room.providerContainerId)
    return {
      allowed: false,
      code: 'WAR_ROOM_TEAM_MISMATCH',
      message: 'War-room team no longer matches its destination.',
    };
  return { allowed: true };
}
