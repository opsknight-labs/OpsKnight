import 'server-only';

import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { evaluateWarRoomPolicy } from '../../policy';
import { adoptWarRoomChannel, claimWarRoomProvisioning, closeWarRoom } from '../../repository';
import { WarRoomRetryableError } from '../../errors';
import {
  createChannel,
  findWarRoomChannel,
  getChannelById,
  warRoomChannelName,
  warRoomMarker,
} from '@/lib/microsoft-teams/graph/channels';
import { getMicrosoftTeamsCapabilities } from '@/lib/microsoft-teams/capabilities';
import { findTeamMember } from '@/lib/microsoft-teams/graph/members';

type RequestResult =
  | { accepted: true; warRoomId: string; state: string }
  | { accepted: false; code: string };
type WarRoomRequestIntent = {
  manual: boolean;
  allowNewGeneration: boolean;
  membershipType?: 'STANDARD' | 'PRIVATE';
};
const AMBIGUOUS_RECONCILIATION_WINDOW_MS = 15 * 60_000;

/** Durable request boundary. No Microsoft I/O occurs here. */
export async function requestMicrosoftTeamsWarRoom(
  incidentId: string,
  intent: WarRoomRequestIntent
): Promise<RequestResult> {
  return runSerializableTransaction(async tx => {
    const incident = await tx.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: {
          select: { microsoftTeamsWarRoomAutoCreate: true, team: { select: { teamLeadId: true } } },
        },
      },
    });
    if (!incident) return { accepted: false, code: 'INCIDENT_NOT_FOUND' };
    if (!['OPEN', 'ACKNOWLEDGED'].includes(incident.status))
      return { accepted: false, code: 'INCIDENT_NOT_ACTIVE' };
    const [config, chatOpsConfig, destination] = await Promise.all([
      tx.microsoftTeamsConfig.findFirst({
        where: { enabled: true },
        orderBy: { updatedAt: 'desc' },
      }),
      tx.chatOpsConfig.findUnique({ where: { id: 'default' } }),
      tx.microsoftTeamsDestination.findFirst({
        where: {
          serviceId: incident.serviceId,
          enabled: true,
          warRoomEnabled: true,
          installation: { is: { enabled: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const { getGlobalWarRoomPolicy, getServiceWarRoomPolicy, resolveIncidentCollaborationPolicy } =
      await import('@/lib/incident-collaboration/policy');

    const [globalPolicy, servicePolicy] = await Promise.all([
      getGlobalWarRoomPolicy(tx),
      incident.serviceId ? getServiceWarRoomPolicy(incident.serviceId, tx) : null,
    ]);

    const canonicalPolicy = resolveIncidentCollaborationPolicy({
      incident: {
        urgency: incident.urgency,
        priority: incident.priority,
        visibility: incident.visibility,
      },
      globalPolicy,
      servicePolicy,
      availableIntegrations: ['MICROSOFT_TEAMS'],
      isTeamsMeetingAvailable: Boolean(config?.enabled),
    });

    if (
      !canonicalPolicy.effectiveProviders.includes('MICROSOFT_TEAMS') ||
      canonicalPolicy.isCollaborationDisabled
    ) {
      return { accepted: false, code: 'PROVIDER_POLICY_EXCLUDED' };
    }

    const effectiveAutoCreate = Boolean(
      canonicalPolicy.shouldAutoCreate &&
      canonicalPolicy.effectiveProviders.includes('MICROSOFT_TEAMS') &&
      !canonicalPolicy.isCollaborationDisabled
    );

    const decision = evaluateWarRoomPolicy({
      incident: {
        urgency: incident.urgency,
        priority: incident.priority,
        visibility: incident.visibility,
      },
      service: { autoCreate: effectiveAutoCreate },
      destination: destination
        ? {
            enabled: destination.enabled,
            warRoomEnabled: destination.warRoomEnabled,
            autoCreate: effectiveAutoCreate,
            membershipType: intent.membershipType ?? destination.warRoomMembershipType,
          }
        : null,
      config: {
        enabled: Boolean(chatOpsConfig?.enabled),
        warRoomsEnabled: Boolean(config?.warRoomsEnabled),
        autoCreateOnUrgency: chatOpsConfig?.autoCreateOnUrgency ?? [],
        autoCreateOnPriority: chatOpsConfig?.autoCreateOnPriority ?? [],
        defaultMembershipType:
          intent.membershipType ?? config?.defaultWarRoomMembershipType ?? 'STANDARD',
      },
      manual: intent.manual,
    });

    if (!decision.allowed || !destination || !destination.installationId)
      return {
        accepted: false,
        code: decision.allowed ? 'DESTINATION_UNAVAILABLE' : decision.code,
      };
    let privateOwner: { userId: string; objectId: string } | null = null;
    if (decision.membershipType === 'PRIVATE') {
      const candidateUserIds = [incident.assigneeId, incident.service.team?.teamLeadId].filter(
        (id): id is string => Boolean(id)
      );
      const links =
        candidateUserIds.length === 0
          ? []
          : await tx.chatIdentityLink.findMany({
              where: {
                provider: 'MICROSOFT_TEAMS',
                providerTenantId: destination.tenantId,
                revokedAt: null,
                userId: { in: candidateUserIds },
              },
              select: { userId: true, providerUserId: true, providerObjectId: true },
            });
      for (const userId of candidateUserIds) {
        const link = links.find(candidate => candidate.userId === userId);
        const objectId = link?.providerObjectId ?? link?.providerUserId;
        if (objectId) {
          privateOwner = { userId, objectId };
          break;
        }
      }

      // If no operator chat link is found, we allow the background worker to attempt
      // resolution via the configured defaultMeetingOrganizerUpn. If neither is available,
      // fail closed immediately without performing any external I/O here.
      if (!privateOwner && !config?.defaultMeetingOrganizerUpn?.trim()) {
        return { accepted: false, code: 'PRIVATE_OWNER_UNAVAILABLE' };
      }
    }

    const claimed = await claimWarRoomProvisioning(tx, {
      incidentId,
      provider: 'MICROSOFT_TEAMS',
      reopen: intent.allowNewGeneration,
    });

    if (claimed.claimed) {
      await tx.incidentWarRoom.updateMany({
        where: { id: claimed.warRoom.id, destinationId: null },
        data: {
          destinationId: destination.id,
          installationId: destination.installationId,
          providerTenantId: destination.tenantId,
          providerContainerId: destination.teamId,
          membershipType: decision.membershipType,
          ...(privateOwner
            ? {
                metadata: {
                  privateOwnerUserId: privateOwner.userId,
                  privateOwnerObjectId: privateOwner.objectId,
                },
              }
            : {}),
        },
      });
      await tx.backgroundJob.create({
        data: {
          type: 'WAR_ROOM_PROVISION',
          status: 'PENDING',
          scheduledAt: new Date(),
          maxAttempts: 6,
          payload: {
            warRoomId: claimed.warRoom.id,
            provisioningToken: claimed.warRoom.provisioningToken,
          },
        },
      });
    }

    return { accepted: true, warRoomId: claimed.warRoom.id, state: claimed.warRoom.state };
  });
}

export async function closeMicrosoftTeamsWarRoom(
  incidentId: string,
  warRoomId: string
): Promise<{ closed: boolean }> {
  const closed = await runSerializableTransaction(tx =>
    closeWarRoom(tx, { incidentId, warRoomId, provider: 'MICROSOFT_TEAMS' })
  );
  return { closed };
}

/**
 * Operator-initiated abandon of an ambiguous canonical card. Clears the
 * commandCreateAttemptedAt fence and commandMessageId so the next projection
 * generation creates a fresh card. Intentionally does NOT delete the
 * potentially-orphaned card; it warns the operator that a duplicate may exist.
 */
export async function abandonAmbiguousMicrosoftTeamsCard(
  incidentId: string,
  warRoomId: string
): Promise<{ abandoned: boolean; warning: string }> {
  const room = await prisma.incidentWarRoom.findFirst({
    where: { id: warRoomId, incidentId, provider: 'MICROSOFT_TEAMS' },
    select: { state: true },
  });
  if (!room) return { abandoned: false, warning: 'War room was not found.' };
  if (room.state === 'CLOSED')
    return {
      abandoned: false,
      warning: 'War room is closed; no replacement card can be projected.',
    };
  const now = new Date();
  const changed = await prisma.incidentWarRoom.updateMany({
    where: {
      id: warRoomId,
      incidentId,
      provider: 'MICROSOFT_TEAMS',
      health: 'DEGRADED',
      lastErrorCode: 'AMBIGUOUS_CARD_CREATE',
    },
    data: {
      commandCreateAttemptedAt: null,
      commandMessageId: null,
      commandConversationId: null,
      health: 'HEALTHY',
      lastErrorCode: null,
      lastError: null,
      projectionLeaseToken: null,
      projectionLeaseExpiresAt: null,
      updatedAt: now,
    },
  });
  if (changed.count !== 1)
    return { abandoned: false, warning: 'War room is not in an ambiguous card state.' };
  // Queue a projection so the next card is created fresh.
  const { requestMicrosoftTeamsWarRoomProjection } = await import('./projection');
  await requestMicrosoftTeamsWarRoomProjection(warRoomId);
  return {
    abandoned: true,
    warning:
      'Ambiguous card abandoned. A duplicate card may still exist in the Teams channel; delete it manually if so.',
  };
}

/**
 * Explicit operator recovery for an uncertain Graph create. This only queues
 * the marker scan guarded by the original fencing token; provisioning refuses
 * to POST once createAttemptedAt is set.
 */
export async function reconcileMicrosoftTeamsWarRoom(
  incidentId: string,
  warRoomId: string
): Promise<{ queued: boolean }> {
  return prisma.$transaction(async tx => {
    const room = await tx.incidentWarRoom.findFirst({
      where: {
        id: warRoomId,
        incidentId,
        provider: 'MICROSOFT_TEAMS',
        state: 'AMBIGUOUS',
        NOT: { createAttemptedAt: { equals: null } },
      },
      select: { id: true, provisioningToken: true },
    });
    if (!room?.provisioningToken) return { queued: false };
    const existing = await tx.backgroundJob.findFirst({
      where: {
        type: 'WAR_ROOM_PROVISION',
        status: { in: ['PENDING', 'PROCESSING'] },
        payload: { path: ['warRoomId'], equals: room.id },
      },
      select: { id: true },
    });
    if (existing) return { queued: true };
    await tx.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_PROVISION',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 6,
        payload: {
          warRoomId: room.id,
          provisioningToken: room.provisioningToken,
          reconciliationOnly: true,
        },
      },
    });
    return { queued: true };
  });
}

/** Bounded, marker-only drift sweep run by the scheduler; it never creates channels. */
export async function reconcileMicrosoftTeamsWarRoomHealth(
  limit = 20
): Promise<{ checked: number; healthy: number; degraded: number }> {
  const rooms = await prisma.incidentWarRoom.findMany({
    where: {
      provider: 'MICROSOFT_TEAMS',
      state: 'READY',
      providerTenantId: { not: null },
      providerContainerId: { not: null },
    },
    orderBy: { lastReconciledAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
    include: { incident: { select: { id: true } } },
  });
  let healthy = 0;
  for (const room of rooms) {
    // Fast path: READY rooms have a durable providerChannelId — verify that
    // single channel directly instead of paginating the entire channel list.
    // Fall back to the marker scan only when the direct probe is inconclusive.
    let result:
      | Awaited<ReturnType<typeof getChannelById>>
      | Awaited<ReturnType<typeof findWarRoomChannel>>;
    if (room.providerChannelId) {
      const direct = await getChannelById({
        tenantId: room.providerTenantId!,
        teamId: room.providerContainerId!,
        channelId: room.providerChannelId,
      });
      if (!direct.ok) {
        // PERMISSION / TRANSIENT / rate-limit — surface directly, no scan needed.
        result = direct;
      } else if (direct.value) {
        const hasMarker = direct.value.description?.includes(
          warRoomMarker(room.incident.id, room.generation)
        );
        if (hasMarker) {
          result = direct; // HEALTHY — single GET, no pagination.
        } else {
          // Channel exists but marker missing (edited away or replaced). Scan
          // by marker to avoid false HEALTHY.
          result = await findWarRoomChannel({
            tenantId: room.providerTenantId!,
            teamId: room.providerContainerId!,
            marker: warRoomMarker(room.incident.id, room.generation),
          });
        }
      } else {
        // Channel id no longer resolves — scan by marker to distinguish deletion
        // from transient Graph listing quirks.
        result = await findWarRoomChannel({
          tenantId: room.providerTenantId!,
          teamId: room.providerContainerId!,
          marker: warRoomMarker(room.incident.id, room.generation),
        });
      }
    } else {
      result = await findWarRoomChannel({
        tenantId: room.providerTenantId!,
        teamId: room.providerContainerId!,
        marker: warRoomMarker(room.incident.id, room.generation),
      });
    }
    const health =
      result.ok && result.value
        ? 'HEALTHY'
        : !result.ok && result.code === 'MISSING_PERMISSION'
          ? 'PERMISSION_ERROR'
          : result.ok
            ? 'MISSING'
            : 'DEGRADED';
    await prisma.incidentWarRoom.update({
      where: { id: room.id },
      data: {
        health,
        lastReconciledAt: new Date(),
        ...(health === 'HEALTHY'
          ? {}
          : {
              lastErrorCode: result.ok ? 'CHANNEL_MISSING' : result.code,
              lastError: result.ok
                ? 'The Teams war-room marker was not found during health reconciliation.'
                : result.message,
            }),
      },
    });
    if (health === 'HEALTHY') healthy++;
  }
  return { checked: rooms.length, healthy, degraded: rooms.length - healthy };
}

/**
 * Resolve settles ready/pre-create rooms immediately. If a Graph create may
 * already be in flight, rotate the fencing token and enqueue a marker-only
 * reconciliation job. The old create worker is cancelled/fenced and the new
 * worker is structurally unable to POST because createAttemptedAt is durable.
 */
export async function settleMicrosoftTeamsWarRoomsOnIncidentResolve(
  incidentId: string
): Promise<void> {
  await runSerializableTransaction(async tx => {
    // This read is deliberately used only to preserve an existing
    // reconciliation lease. State classification happens in the conditional
    // updates below, so a create worker cannot be failed from stale data.
    const before = await tx.incidentWarRoom.findMany({
      where: {
        incidentId,
        provider: 'MICROSOFT_TEAMS',
        state: { in: ['PROVISIONING', 'AMBIGUOUS'] },
      },
      select: {
        id: true,
        provisioningToken: true,
        lastErrorCode: true,
      },
    });
    const now = new Date();
    const unsettled: Prisma.IncidentWarRoomWhereInput = {
      incidentId,
      provider: 'MICROSOFT_TEAMS',
      state: { in: ['PROVISIONING', 'AMBIGUOUS'] },
    };

    // Predicate-bearing updates fence the create boundary without a TOCTOU
    // read. Repeat the attempted pass to catch a worker that records its
    // durable attempt between the first pass and the pre-create failure pass.
    await tx.incidentWarRoom.updateMany({
      where: { ...unsettled, createAttemptedAt: { not: null } },
      data: {
        state: 'AMBIGUOUS',
        lastErrorCode: 'INCIDENT_RESOLVED_DURING_CREATE',
        lastError:
          'Incident resolved while channel creation may have completed; reconciling by marker only.',
      },
    });
    await tx.incidentWarRoom.updateMany({
      where: { ...unsettled, createAttemptedAt: null },
      data: {
        state: 'FAILED',
        provisioningToken: null,
        lastErrorCode: 'INCIDENT_RESOLVED',
        lastError: 'Incident resolved before Teams channel creation began.',
      },
    });
    await tx.incidentWarRoom.updateMany({
      where: { ...unsettled, createAttemptedAt: { not: null } },
      data: {
        state: 'AMBIGUOUS',
        lastErrorCode: 'INCIDENT_RESOLVED_DURING_CREATE',
        lastError:
          'Incident resolved while channel creation may have completed; reconciling by marker only.',
      },
    });
    const rooms = await tx.incidentWarRoom.findMany({
      where: {
        incidentId,
        provider: 'MICROSOFT_TEAMS',
        state: { in: ['FAILED', 'CLOSED', 'AMBIGUOUS'] },
      },
      select: { id: true, state: true, createAttemptedAt: true, provisioningToken: true },
    });
    if (rooms.length === 0) return;
    const beforeById = new Map(before.map(room => [room.id, room]));
    const reconciliationClaims: Array<{ roomId: string; token: string }> = [];
    for (const room of rooms) {
      if (room.state !== 'AMBIGUOUS' || !room.createAttemptedAt) continue;
      const prior = beforeById.get(room.id);
      const alreadyReconciliationOnly =
        prior?.lastErrorCode === 'INCIDENT_RESOLVED_DURING_CREATE' &&
        Boolean(prior.provisioningToken);
      const token = alreadyReconciliationOnly ? prior.provisioningToken! : crypto.randomUUID();
      const changed = await tx.incidentWarRoom.updateMany({
        where: {
          id: room.id,
          state: 'AMBIGUOUS',
          createAttemptedAt: { not: null },
          provisioningToken: room.provisioningToken,
        },
        data: {
          provisioningToken: token,
          provisioningStartedAt: alreadyReconciliationOnly ? undefined : now,
        },
      });
      if (changed.count === 1) reconciliationClaims.push({ roomId: room.id, token });
    }

    const roomIds = new Set(rooms.map(room => room.id));
    const activeJobs = await tx.backgroundJob.findMany({
      where: { type: 'WAR_ROOM_PROVISION', status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true, payload: true },
    });
    const reconciliationByRoom = new Map(
      reconciliationClaims.map(claim => [claim.roomId, claim.token] as const)
    );
    const keptReconciliationJobs = new Set<string>();
    const cancelJobIds: string[] = [];

    for (const job of activeJobs) {
      const payload = job.payload as Record<string, unknown> | null;
      const roomId = typeof payload?.warRoomId === 'string' ? payload.warRoomId : null;
      const token =
        typeof payload?.provisioningToken === 'string' ? payload.provisioningToken : null;
      if (!roomId || !roomIds.has(roomId)) continue;
      const reconciliationToken = reconciliationByRoom.get(roomId);
      if (reconciliationToken && token === reconciliationToken) {
        keptReconciliationJobs.add(roomId);
      } else {
        cancelJobIds.push(job.id);
      }
    }

    if (cancelJobIds.length > 0)
      await tx.backgroundJob.updateMany({
        where: { id: { in: cancelJobIds }, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'CANCELLED',
          completedAt: now,
          error: 'Incident resolved; create worker fenced',
        },
      });

    for (const claim of reconciliationClaims) {
      if (keptReconciliationJobs.has(claim.roomId)) continue;
      await tx.backgroundJob.create({
        data: {
          type: 'WAR_ROOM_PROVISION',
          status: 'PENDING',
          scheduledAt: now,
          maxAttempts: 6,
          payload: {
            warRoomId: claim.roomId,
            provisioningToken: claim.token,
            reconciliationOnly: true,
          },
        },
      });
    }
  });
  // READY → CLOSING must use the neutral durable close (atomic CLOSING + projection + WAR_ROOM_CLOSE)
  // so a crash never leaves CLOSING without jobs and projection never owns archive.
  const readyRooms = await prisma.incidentWarRoom.findMany({
    where: { incidentId, provider: 'MICROSOFT_TEAMS', state: 'READY' },
    select: { id: true },
  });
  if (readyRooms.length > 0) {
    const { closeWarRoomNeutral } = await import('../../engine');
    await Promise.all(readyRooms.map(r => closeWarRoomNeutral({ incidentId, warRoomId: r.id })));
  }
}

async function adoptProviderChannel(
  room: {
    id: string;
    provisioningToken: string | null;
    providerTenantId: string | null;
    providerContainerId: string | null;
  },
  expectedProvisioningToken: string,
  channel: { id: string; displayName: string; webUrl?: string | null }
) {
  if (!room.provisioningToken || !room.providerTenantId || !room.providerContainerId)
    return 'FENCED' as const;

  return runSerializableTransaction(tx =>
    adoptWarRoomChannel(tx, {
      warRoomId: room.id,
      provisioningToken: expectedProvisioningToken,
      tenantId: room.providerTenantId!,
      teamId: room.providerContainerId!,
      channelId: channel.id,
      channelName: channel.displayName,
      channelUrl: channel.webUrl ?? null,
    })
  );
}

/** Worker entry point. Every retry reconciles this same generation before POST. */
export async function provisionMicrosoftTeamsWarRoom(
  warRoomId: string,
  expectedProvisioningToken: string,
  opts?: { reconciliationOnly?: boolean }
): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: { incident: { select: { id: true, title: true, status: true } } },
  });

  const reconciliationOnly = opts?.reconciliationOnly === true;

  if (
    !room ||
    room.provisioningToken !== expectedProvisioningToken ||
    room.provider !== 'MICROSOFT_TEAMS' ||
    !room.provisioningToken ||
    !room.providerTenantId ||
    !room.providerContainerId ||
    !room.membershipType
  )
    return;

  if (reconciliationOnly) {
    if (!['AMBIGUOUS', 'CLOSING'].includes(room.state)) return;
  } else {
    if (!['PROVISIONING', 'AMBIGUOUS'].includes(room.state)) return;
  }

  const marker = warRoomMarker(room.incident.id, room.generation);
  const existing = await findWarRoomChannel({
    tenantId: room.providerTenantId,
    teamId: room.providerContainerId,
    marker,
  });

  if (existing.ok && existing.value) {
    const adoption = await adoptProviderChannel(room, expectedProvisioningToken, existing.value);
    if (adoption === 'CLOSING') {
      await ensureTeamsTerminalCloseHandoff(room.id, room.incident.id);
    } else if (adoption === 'READY') {
      const { scheduleJob } = await import('@/lib/jobs/queue');
      await scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId: room.id }, 5);
      const { requestMicrosoftTeamsWarRoomProjection } = await import('./projection');
      await requestMicrosoftTeamsWarRoomProjection(room.id);
    }
    return;
  }

  if (!existing.ok) {
    const isClosingReconciliation =
      reconciliationOnly && room.state === 'CLOSING' && room.createAttemptedAt != null;
    const closingReconciliationDeadline = isClosingReconciliation
      ? room.createAttemptedAt!.getTime() + AMBIGUOUS_RECONCILIATION_WINDOW_MS
      : 0;
    const closingReconciliationExpired =
      isClosingReconciliation && Date.now() >= closingReconciliationDeadline;
    if (
      existing.code === 'TRANSIENT_READ' ||
      existing.code === 'RATE_LIMITED' ||
      existing.code === 'GRAPH_TOKEN_FAILED'
    ) {
      if (isClosingReconciliation) {
        if (closingReconciliationExpired) {
          await prisma.incidentWarRoom
            .updateMany({
              where: {
                id: room.id,
                provisioningToken: expectedProvisioningToken,
                state: 'CLOSING',
              },
              data: {
                health: 'DEGRADED',
                lastErrorCode: `RECONCILIATION_EXPIRED_TEAMS_${existing.code}`,
                lastError: `Teams reconciliation lookup ${existing.code} beyond window; closing locally as DEGRADED with unverified external outcome. Provider drift will be reconciled asynchronously.`,
                provisioningToken: null,
                externalCleanupPending: true,
                externalCleanupReason: `RECONCILIATION_EXPIRED_TEAMS_${existing.code}`,
                externalCleanupLastAttemptAt: new Date(),
              },
            })
            .catch(() => {});
          const fresh = await prisma.incidentWarRoom.findUnique({
            where: { id: room.id },
            select: { incidentId: true },
          });
          if (fresh) await ensureTeamsTerminalCloseHandoff(room.id, fresh.incidentId);
          return;
        }
        await prisma.incidentWarRoom
          .updateMany({
            where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
            data: {
              health: 'DEGRADED',
              lastErrorCode: `RECONCILIATION_LOOKUP_${existing.code}`,
              lastError: existing.message.slice(0, 1000),
            },
          })
          .catch(() => {});
        throw new WarRoomRetryableError(existing.message, existing.retryAfterMs ?? 30_000, true);
      }
      throw new WarRoomRetryableError(existing.message, existing.retryAfterMs);
    }
    if (isClosingReconciliation) {
      if (closingReconciliationExpired) {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
          data: {
            health: existing.code === 'MISSING_PERMISSION' ? 'PERMISSION_ERROR' : 'DEGRADED',
            lastErrorCode: `RECONCILIATION_EXPIRED_TEAMS_${existing.code}`,
            lastError: `Teams reconciliation lookup ${existing.code} beyond window; closing locally as DEGRADED with unverified external outcome.`,
            provisioningToken: null,
            externalCleanupPending: true,
            externalCleanupReason: `RECONCILIATION_EXPIRED_TEAMS_${existing.code}`,
            externalCleanupLastAttemptAt: new Date(),
          },
        });
        const fresh = await prisma.incidentWarRoom.findUnique({
          where: { id: room.id },
          select: { incidentId: true },
        });
        if (fresh) await ensureTeamsTerminalCloseHandoff(room.id, fresh.incidentId);
        return;
      }
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
        data: {
          health: existing.code === 'MISSING_PERMISSION' ? 'PERMISSION_ERROR' : 'DEGRADED',
          lastErrorCode: `RECONCILIATION_LOOKUP_${existing.code}`,
          lastError: existing.message.slice(0, 1000),
        },
      });
      throw new WarRoomRetryableError(
        `CLOSING Teams reconciliation lookup failed (${existing.code}); retrying.`,
        30_000,
        true
      );
    }
    await markFailed(room.id, expectedProvisioningToken, existing.code, existing.message);
    return;
  }

  if (reconciliationOnly) {
    if (room.state === 'CLOSING' && room.createAttemptedAt) {
      const deadline = room.createAttemptedAt.getTime() + AMBIGUOUS_RECONCILIATION_WINDOW_MS;
      const remaining = deadline - Date.now();
      if (remaining > 0)
        throw new WarRoomRetryableError(
          'Reconciling CLOSING Teams channel-create by marker only.',
          Math.min(60_000, remaining),
          true
        );
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
        data: {
          lastErrorCode: 'CREATE_RECONCILIATION_EXHAUSTED',
          lastError:
            'No Teams channel was found by marker during the reconciliation window; closing without external channel.',
          provisioningToken: null,
        },
      });
      const freshClose = await prisma.incidentWarRoom.findUnique({
        where: { id: room.id },
        select: { incidentId: true },
      });
      if (freshClose) {
        await ensureTeamsTerminalCloseHandoff(room.id, freshClose.incidentId);
      }
    }
    return;
  }

  // createAttemptedAt is the durable one-way gate: after it is set, no worker
  // for this generation may ever issue another channel-create POST.
  if (room.createAttemptedAt) {
    const deadline = room.createAttemptedAt.getTime() + AMBIGUOUS_RECONCILIATION_WINDOW_MS;
    const remaining = deadline - Date.now();
    const reconciled = await prisma.incidentWarRoom.updateMany({
      where: {
        id: room.id,
        provisioningToken: expectedProvisioningToken,
        state: { in: ['PROVISIONING', 'AMBIGUOUS'] },
      },
      data: {
        state: 'AMBIGUOUS',
        lastErrorCode: remaining > 0 ? 'CREATE_OUTCOME_RECONCILING' : 'CREATE_OUTCOME_UNRESOLVED',
        lastError:
          remaining > 0
            ? 'A prior Teams channel-create may have succeeded; reconciling by marker only.'
            : 'Teams channel-create outcome remains unresolved after the reconciliation window; operator reconciliation is required.',
      },
    });
    if (remaining > 0)
      throw new WarRoomRetryableError(
        'Reconciling an ambiguous Teams channel-create outcome by marker only.',
        Math.min(60_000, remaining),
        true
      );
    // A complete bounded marker scan found no room after the provider's
    // consistency window. Only now is the unknown create terminally failed.
    if (reconciled.count === 1) {
      await prisma.incidentWarRoom.updateMany({
        where: {
          id: room.id,
          provisioningToken: expectedProvisioningToken,
          state: 'AMBIGUOUS',
          createAttemptedAt: { not: null },
        },
        data: {
          state: 'FAILED',
          provisioningToken: null,
          lastErrorCode: 'CREATE_RECONCILIATION_EXHAUSTED',
          lastError: 'No Teams channel was found by marker during the reconciliation window.',
        },
      });
      const postFail = await prisma.incidentWarRoom.findUnique({
        where: { id: room.id },
        select: { closeRequestedAt: true },
      });
      if ((postFail as { closeRequestedAt?: Date | null } | null)?.closeRequestedAt != null) {
        const { closeWarRoomNeutral } = await import('../../engine');
        await closeWarRoomNeutral({ incidentId: room.incident.id, warRoomId: room.id }).catch(
          () => {}
        );
      }
    }
    return;
  }

  const metadata = room.metadata as {
    privateOwnerObjectId?: unknown;
    privateOwnerUserId?: unknown;
  } | null;
  let privateOwnerObjectId =
    typeof metadata?.privateOwnerObjectId === 'string' ? metadata.privateOwnerObjectId : null;
  if (room.membershipType === 'PRIVATE') {
    let owner: Awaited<ReturnType<typeof findTeamMember>> | null = null;

    if (privateOwnerObjectId) {
      const ownerCheck = await findTeamMember({
        tenantId: room.providerTenantId,
        teamId: room.providerContainerId,
        userObjectId: privateOwnerObjectId,
      });
      if (!ownerCheck.ok) {
        if (
          ownerCheck.code === 'RATE_LIMITED' ||
          ownerCheck.code === 'TRANSIENT_READ' ||
          ownerCheck.code === 'GRAPH_TOKEN_FAILED'
        )
          throw new WarRoomRetryableError(ownerCheck.message, ownerCheck.retryAfterMs);
        return markFailed(room.id, expectedProvisioningToken, ownerCheck.code, ownerCheck.message);
      }
      if (ownerCheck.value) {
        owner = ownerCheck;
      }
    }

    if (!owner?.value) {
      // Fallback 1: Re-resolve from incident assignee / team-lead links
      const incidentForFallback = await prisma.incident.findUnique({
        where: { id: room.incident.id },
        select: {
          assigneeId: true,
          service: { select: { team: { select: { teamLeadId: true } } } },
        },
      });
      const fallbackCandidates = [
        incidentForFallback?.assigneeId,
        incidentForFallback?.service.team?.teamLeadId,
      ].filter((id): id is string => Boolean(id));

      if (fallbackCandidates.length > 0) {
        const destinationTenant = room.providerTenantId;
        const fallbackLinks = await prisma.chatIdentityLink.findMany({
          where: {
            provider: 'MICROSOFT_TEAMS',
            providerTenantId: destinationTenant,
            revokedAt: null,
            userId: { in: fallbackCandidates },
          },
          select: { userId: true, providerUserId: true, providerObjectId: true },
        });
        for (const userId of fallbackCandidates) {
          if (userId === (metadata?.privateOwnerUserId as string | undefined)) continue;
          const link = fallbackLinks.find(candidate => candidate.userId === userId);
          const objectId = link?.providerObjectId ?? link?.providerUserId ?? null;
          if (!objectId) continue;
          const candidateOwner = await findTeamMember({
            tenantId: room.providerTenantId,
            teamId: room.providerContainerId,
            userObjectId: objectId,
          });
          if (!candidateOwner.ok) {
            if (
              candidateOwner.code === 'RATE_LIMITED' ||
              candidateOwner.code === 'TRANSIENT_READ' ||
              candidateOwner.code === 'GRAPH_TOKEN_FAILED'
            )
              throw new WarRoomRetryableError(candidateOwner.message, candidateOwner.retryAfterMs);
            return markFailed(
              room.id,
              expectedProvisioningToken,
              candidateOwner.code,
              candidateOwner.message
            );
          }
          if (!candidateOwner.value) continue;
          await prisma.incidentWarRoom.updateMany({
            where: { id: room.id, provisioningToken: expectedProvisioningToken },
            data: { metadata: { privateOwnerUserId: userId, privateOwnerObjectId: objectId } },
          });
          privateOwnerObjectId = objectId;
          owner = candidateOwner;
          break;
        }
      }

      // Fallback 2: Resolve configured defaultMeetingOrganizerUpn via Graph
      if (!owner?.value) {
        const teamsConfig = await prisma.microsoftTeamsConfig.findFirst({
          where: { enabled: true },
          select: { defaultMeetingOrganizerUpn: true },
        });
        if (teamsConfig?.defaultMeetingOrganizerUpn?.trim()) {
          const upn = teamsConfig.defaultMeetingOrganizerUpn.trim();
          const { findUserByUpn } = await import('@/lib/microsoft-teams/graph/members');
          const userLookup = await findUserByUpn({
            tenantId: room.providerTenantId,
            upn,
          });
          if (!userLookup.ok) {
            if (
              userLookup.code === 'RATE_LIMITED' ||
              userLookup.code === 'TRANSIENT_READ' ||
              userLookup.code === 'GRAPH_TOKEN_FAILED'
            ) {
              throw new WarRoomRetryableError(userLookup.message, userLookup.retryAfterMs);
            }
            return markFailed(
              room.id,
              expectedProvisioningToken,
              userLookup.code,
              userLookup.message
            );
          }
          if (userLookup.value?.id) {
            const candidateOwner = await findTeamMember({
              tenantId: room.providerTenantId,
              teamId: room.providerContainerId,
              userObjectId: userLookup.value.id,
            });
            if (!candidateOwner.ok) {
              if (
                candidateOwner.code === 'RATE_LIMITED' ||
                candidateOwner.code === 'TRANSIENT_READ' ||
                candidateOwner.code === 'GRAPH_TOKEN_FAILED'
              ) {
                throw new WarRoomRetryableError(
                  candidateOwner.message,
                  candidateOwner.retryAfterMs
                );
              }
              return markFailed(
                room.id,
                expectedProvisioningToken,
                candidateOwner.code,
                candidateOwner.message
              );
            }
            if (candidateOwner.value) {
              await prisma.incidentWarRoom.updateMany({
                where: { id: room.id, provisioningToken: expectedProvisioningToken },
                data: {
                  metadata: {
                    privateOwnerUserId: 'system-organizer',
                    privateOwnerObjectId: userLookup.value.id,
                  },
                },
              });
              privateOwnerObjectId = userLookup.value.id;
              owner = candidateOwner;
            }
          }
        }
      }

      if (!owner?.value || !privateOwnerObjectId) {
        return markFailed(
          room.id,
          expectedProvisioningToken,
          'PRIVATE_OWNER_UNAVAILABLE',
          'Private Teams war rooms require a verified owner in the parent Team.'
        );
      }
    }
  }

  const current = await prisma.incidentWarRoom.findUnique({
    where: { id: room.id },
    select: { provisioningToken: true, state: true },
  });
  if (
    !current ||
    current.provisioningToken !== expectedProvisioningToken ||
    !['PROVISIONING', 'AMBIGUOUS'].includes(current.state)
  )
    return;

  const authority = await validateWarRoomProvisioningAuthority(room);
  if (!authority.allowed) {
    if (room.state === 'AMBIGUOUS') return;
    await markFailed(room.id, expectedProvisioningToken, authority.code, authority.message);
    return;
  }

  const operationId = crypto.randomUUID();
  const renewed = await prisma.incidentWarRoom.updateMany({
    where: {
      id: room.id,
      provisioningToken: expectedProvisioningToken,
      state: { in: ['PROVISIONING', 'AMBIGUOUS'] },
    },
    data: {
      provisioningStartedAt: new Date(),
      createAttemptedAt: new Date(),
      createOperationId: operationId,
    },
  });
  if (renewed.count !== 1) return;

  const created = await createChannel({
    tenantId: room.providerTenantId,
    teamId: room.providerContainerId,
    displayName: warRoomChannelName(room.incident.id, room.generation, room.incident.title),
    description: marker,
    membershipType: room.membershipType,
    ...(room.membershipType === 'PRIVATE' ? { ownerObjectId: privateOwnerObjectId! } : {}),
  });

  if (!created.ok) {
    if (created.code === 'AMBIGUOUS_CREATE') {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken },
        data: { state: 'AMBIGUOUS', lastErrorCode: created.code, lastError: created.message },
      });
      throw new WarRoomRetryableError(created.message, created.retryAfterMs);
    }
    if (
      created.code === 'RATE_LIMITED' ||
      created.code === 'GRAPH_TOKEN_FAILED' ||
      created.code === 'TRANSIENT_READ'
    )
      throw new WarRoomRetryableError(created.message, created.retryAfterMs);
    await markFailed(room.id, expectedProvisioningToken, created.code, created.message);
    return;
  }
  const adoption = await adoptProviderChannel(room, expectedProvisioningToken, created.value);
  if (adoption === 'CLOSING') {
    await ensureTeamsTerminalCloseHandoff(room.id, room.incident.id);
  } else if (adoption === 'READY') {
    const { scheduleJob } = await import('@/lib/jobs/queue');
    await scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId: room.id }, 5);
    const { requestMicrosoftTeamsWarRoomProjection } = await import('./projection');
    await requestMicrosoftTeamsWarRoomProjection(room.id);
  }
  if (adoption === 'FENCED')
    await prisma.incidentWarRoom.updateMany({
      where: {
        id: room.id,
        provisioningToken: expectedProvisioningToken,
        state: { in: ['PROVISIONING', 'AMBIGUOUS'] },
      },
      data: {
        state: 'AMBIGUOUS',
        lastErrorCode: 'DATABASE_COMMIT_FAILED',
        lastError: 'Channel may have been created; reconcile by marker before retrying.',
      },
    });
}

async function markFailed(
  id: string,
  provisioningToken: string,
  code: string,
  message: string
): Promise<void> {
  await prisma.incidentWarRoom.updateMany({
    where: {
      id,
      provisioningToken,
      state: { in: ['PROVISIONING', 'AMBIGUOUS'] },
    },
    data: {
      state: 'FAILED',
      lastErrorCode: code,
      lastError: message.slice(0, 1000),
      provisioningToken: null,
    },
  });
}

async function ensureTeamsTerminalCloseHandoff(
  warRoomId: string,
  incidentId: string
): Promise<void> {
  const { ensureTerminalCloseJobsAfterClosingAdoption } = await import('../../engine');
  const { closeWarRoomNeutral } = await import('../../engine');
  let ensured = false;
  let ensureError: unknown = null;
  try {
    await ensureTerminalCloseJobsAfterClosingAdoption(warRoomId, incidentId);
    ensured = true;
  } catch (e) {
    ensureError = e;
  }
  const existing = await prisma.backgroundJob.findFirst({
    where: {
      type: 'WAR_ROOM_CLOSE',
      status: { in: ['PENDING', 'PROCESSING'] },
      payload: { path: ['warRoomId'], equals: warRoomId },
    },
    select: { id: true },
  });
  if (existing) return;
  if (!ensured && ensureError) throw ensureError;
  await closeWarRoomNeutral({ incidentId, warRoomId });
  const afterRepair = await prisma.backgroundJob.findFirst({
    where: {
      type: 'WAR_ROOM_CLOSE',
      status: { in: ['PENDING', 'PROCESSING'] },
      payload: { path: ['warRoomId'], equals: warRoomId },
    },
    select: { id: true },
  });
  if (!afterRepair) {
    throw new WarRoomRetryableError(
      'Terminal close ownership not yet durable; retrying.',
      2000,
      true
    );
  }
}

async function validateWarRoomProvisioningAuthority(room: {
  destinationId: string | null;
  installationId: string | null;
  providerTenantId: string | null;
  providerContainerId: string | null;
  membershipType: 'STANDARD' | 'PRIVATE' | null;
  incident: { id: string; status: string };
}): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
  const currentIncident = await prisma.incident.findUnique({
    where: { id: room.incident.id },
    select: { status: true },
  });
  if (!currentIncident || !['OPEN', 'ACKNOWLEDGED'].includes(currentIncident.status))
    return {
      allowed: false,
      code: 'INCIDENT_NOT_ACTIVE',
      message: 'Incident is no longer active.',
    };
  if (!room.destinationId)
    return {
      allowed: false,
      code: 'DESTINATION_SNAPSHOT_MISSING',
      message: 'War-room routing snapshot is missing.',
    };

  const [config, destination, installation] = await Promise.all([
    prisma.microsoftTeamsConfig.findFirst({
      where: { enabled: true, warRoomsEnabled: true },
      select: { id: true },
    }),
    prisma.microsoftTeamsDestination.findUnique({
      where: { id: room.destinationId },
      select: { enabled: true, warRoomEnabled: true, installationId: true },
    }),
    room.installationId
      ? prisma.microsoftTeamsInstallation.findUnique({
          where: { id: room.installationId },
          select: { enabled: true },
        })
      : Promise.resolve(null),
  ]);

  if (
    !config ||
    !destination?.enabled ||
    !destination.warRoomEnabled ||
    (room.installationId &&
      (!installation?.enabled || destination.installationId !== room.installationId))
  )
    return {
      allowed: false,
      code: 'WAR_ROOM_AUTHORITY_REVOKED',
      message: 'Microsoft Teams war-room configuration or installation was disabled.',
    };

  const capabilities = await getMicrosoftTeamsCapabilities({
    tenantId: room.providerTenantId ?? undefined,
    teamId: room.providerContainerId ?? undefined,
  });
  if (!capabilities.canCreateWarRooms)
    return {
      allowed: false,
      code: 'WAR_ROOM_CAPABILITY_UNAVAILABLE',
      message:
        capabilities.failureReason ?? 'Microsoft Teams channel-create capability is unavailable.',
    };
  if (room.membershipType === 'PRIVATE' && !capabilities.canCreatePrivateWarRooms)
    return {
      allowed: false,
      code: 'PRIVATE_WAR_ROOM_CAPABILITY_UNAVAILABLE',
      message:
        'Microsoft Teams private war rooms require verified member-management consent for this Team.',
    };
  return { allowed: true };
}
