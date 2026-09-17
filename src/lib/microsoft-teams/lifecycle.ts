import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { emitAuditEvent } from '@/lib/audit';
import { clearMicrosoftTeamsTokenCaches } from './client';

type TeamsRevocationScope = {
  destinationIds?: string[];
  reason: string;
};

/**
 * Settle Teams delivery work without ever converting an unknown external
 * side-effect into a known failure. Callers own the surrounding transaction so
 * routing disablement and delivery fencing commit atomically.
 */
export async function revokeMicrosoftTeamsOperations(
  tx: Prisma.TransactionClient,
  scope: TeamsRevocationScope
): Promise<{ operationIds: string[]; jobsCancelled: number }> {
  const destinationSet = scope.destinationIds ? new Set(scope.destinationIds) : null;
  const candidates = await tx.externalOperation.findMany({
    where: { provider: 'MICROSOFT_TEAMS', status: { in: ['PENDING', 'PROCESSING', 'AMBIGUOUS'] } },
    select: { id: true, status: true, requestPayload: true, resultPayload: true },
  });
  const operations = candidates.filter(operation => {
    if (!destinationSet) return true;
    const destinationId = (operation.requestPayload as Record<string, unknown> | null)
      ?.destinationId;
    return typeof destinationId === 'string' && destinationSet.has(destinationId);
  });

  for (const operation of operations) {
    const request = operation.requestPayload as Record<string, unknown> | null;
    const destinationId = typeof request?.destinationId === 'string' ? request.destinationId : '';
    const result = operation.resultPayload as Record<string, unknown> | null;
    const remainsAmbiguous =
      operation.status === 'AMBIGUOUS' ||
      (operation.status === 'PROCESSING' && result?.createAttempted === true);
    if (remainsAmbiguous) {
      await tx.microsoftTeamsIncidentMessage.updateMany({
        where: { destinationId, createOperationId: operation.id },
        data: { createState: 'AMBIGUOUS', mutationLeaseToken: null, mutationLeaseExpiresAt: null },
      });
    } else {
      await tx.microsoftTeamsIncidentMessage.deleteMany({
        where: { destinationId, messageId: `__reserved__:${operation.id}` },
      });
      await tx.microsoftTeamsIncidentMessage.updateMany({
        where: { destinationId, createOperationId: operation.id },
        data: {
          createState: 'NONE',
          createOperationId: null,
          mutationLeaseToken: null,
          mutationLeaseExpiresAt: null,
        },
      });
    }
    await tx.externalOperation.update({
      where: { id: operation.id },
      data: {
        status: remainsAmbiguous ? 'AMBIGUOUS' : 'FAILED',
        nextAttemptAt: remainsAmbiguous ? new Date('9999-12-31T23:59:59.999Z') : new Date(),
        lastError: remainsAmbiguous
          ? `${scope.reason}; the create may have completed and requires manual reconciliation.`
          : `${scope.reason}; queued delivery revoked.`,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  }

  const operationIds = operations.map(operation => operation.id);
  if (operationIds.length === 0) return { operationIds, jobsCancelled: 0 };
  const operationSet = new Set(operationIds);
  const jobs = await tx.backgroundJob.findMany({
    where: { type: 'EXTERNAL_OPERATION', status: { in: ['PENDING', 'PROCESSING'] } },
    select: { id: true, payload: true },
  });
  const jobIds = jobs
    .filter(job => {
      const operationId = (job.payload as Record<string, unknown> | null)?.operationId;
      return typeof operationId === 'string' && operationSet.has(operationId);
    })
    .map(job => job.id);
  if (jobIds.length > 0) {
    await tx.backgroundJob.updateMany({
      where: { id: { in: jobIds } },
      data: { status: 'CANCELLED', completedAt: new Date(), error: scope.reason },
    });
  }
  return { operationIds, jobsCancelled: jobIds.length };
}

/**
 * Revoke every unsettled Teams war-room provisioning lease in the same
 * transaction that removes its authority.  A create that has crossed the
 * network boundary is deliberately retained as AMBIGUOUS: treating it as a
 * failure would permit a later worker to duplicate a channel.
 *
 * Also fences collaboration jobs (WAR_ROOM_PROJECT / WAR_ROOM_PARTICIPANT_SYNC)
 * for READY/CLOSING rooms whose authority was revoked: their in-flight Graph
 * attempts are cancelled and their health is degraded so the queue retry path
 * cannot leak a stale projection or member sync.
 */
export async function revokeMicrosoftTeamsWarRoomProvisioning(
  tx: Prisma.TransactionClient,
  scope: TeamsRevocationScope
): Promise<{ warRoomIds: string[]; jobsCancelled: number }> {
  const destinationSet = scope.destinationIds ? new Set(scope.destinationIds) : null;
  const rooms = await tx.incidentWarRoom.findMany({
    where: { provider: 'MICROSOFT_TEAMS', state: { in: ['PROVISIONING', 'AMBIGUOUS'] } },
    select: { id: true, destinationId: true, createAttemptedAt: true },
  });
  const candidates = rooms.filter(
    room => !destinationSet || (room.destinationId && destinationSet.has(room.destinationId))
  );
  const attemptedIds = candidates.filter(room => room.createAttemptedAt).map(room => room.id);
  const safeIds = candidates.filter(room => !room.createAttemptedAt).map(room => room.id);
  const now = new Date();

  if (attemptedIds.length > 0) {
    await tx.incidentWarRoom.updateMany({
      where: { id: { in: attemptedIds }, state: { in: ['PROVISIONING', 'AMBIGUOUS'] } },
      data: {
        state: 'AMBIGUOUS',
        provisioningToken: null,
        lastErrorCode: 'WAR_ROOM_AUTHORITY_REVOKED',
        lastError: `${scope.reason}; channel creation may have completed and requires marker reconciliation.`,
      },
    });
  }
  if (safeIds.length > 0) {
    await tx.incidentWarRoom.updateMany({
      where: { id: { in: safeIds }, state: { in: ['PROVISIONING', 'AMBIGUOUS'] } },
      data: {
        state: 'FAILED',
        provisioningToken: null,
        lastErrorCode: 'WAR_ROOM_AUTHORITY_REVOKED',
        lastError: scope.reason,
      },
    });
  }

  // Collaboration surface: READY/CLOSING rooms that were routing through the
  // revoked destination must not keep projecting cards or syncing members.
  const collaborationRooms = await tx.incidentWarRoom.findMany({
    where: { provider: 'MICROSOFT_TEAMS', state: { in: ['READY', 'CLOSING'] } },
    select: { id: true, destinationId: true },
  });
  const collaborationCandidates = collaborationRooms.filter(
    room => !destinationSet || (room.destinationId && destinationSet.has(room.destinationId))
  );
  if (collaborationCandidates.length > 0) {
    await tx.incidentWarRoom.updateMany({
      where: { id: { in: collaborationCandidates.map(room => room.id) } },
      data: {
        health: 'DEGRADED',
        lastErrorCode: 'WAR_ROOM_AUTHORITY_REVOKED',
        lastError: scope.reason,
        projectionLeaseToken: null,
        projectionLeaseExpiresAt: null,
      },
    });
  }

  const roomIds = [
    ...candidates.map(room => room.id),
    ...collaborationCandidates.map(room => room.id),
  ];
  if (roomIds.length === 0) return { warRoomIds: [], jobsCancelled: 0 };
  const jobs = await tx.backgroundJob.findMany({
    where: {
      type: { in: ['WAR_ROOM_PROVISION', 'WAR_ROOM_PROJECT', 'WAR_ROOM_PARTICIPANT_SYNC'] },
      status: { in: ['PENDING', 'PROCESSING'] },
    },
    select: { id: true, payload: true },
  });
  const roomSet = new Set(roomIds);
  const jobIds = jobs
    .filter(job => {
      const warRoomId = (job.payload as Record<string, unknown> | null)?.warRoomId;
      return typeof warRoomId === 'string' && roomSet.has(warRoomId);
    })
    .map(job => job.id);
  if (jobIds.length > 0) {
    await tx.backgroundJob.updateMany({
      where: { id: { in: jobIds }, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'CANCELLED', completedAt: now, error: scope.reason },
    });
  }
  // Deduplicate warRoomIds across provision + collaboration surfaces.
  return { warRoomIds: [...new Set(roomIds)], jobsCancelled: jobIds.length };
}

export async function disconnectMicrosoftTeamsIntegration(
  actorId: string,
  options?: { deleteConfig?: boolean }
): Promise<void> {
  const deleteConfig = options?.deleteConfig ?? true;
  await prisma.$transaction(async tx => {
    const destinations = await tx.microsoftTeamsDestination.findMany({
      select: { id: true, serviceId: true },
    });
    const routedServices = await tx.service.findMany({
      where: { serviceNotificationChannels: { has: 'MICROSOFT_TEAMS' } },
      select: { id: true, serviceNotificationChannels: true },
    });

    for (const service of routedServices) {
      await tx.service.update({
        where: { id: service.id },
        data: {
          serviceNotificationChannels: service.serviceNotificationChannels.filter(
            channel => channel !== 'MICROSOFT_TEAMS'
          ),
        },
      });
    }

    const revoked = await revokeMicrosoftTeamsOperations(tx, {
      reason: 'Microsoft Teams integration disconnected',
    });
    const revokedWarRooms = await revokeMicrosoftTeamsWarRoomProvisioning(tx, {
      reason: 'Microsoft Teams integration disconnected',
    });

    if (deleteConfig) {
      await tx.microsoftTeamsIncidentMessage.deleteMany({});
      await tx.microsoftTeamsDestination.deleteMany({});
      await tx.microsoftTeamsInstallation.deleteMany({});
      await tx.microsoftTeamsConfig.deleteMany({});
    } else {
      await tx.microsoftTeamsConfig.updateMany({
        data: { enabled: false, interactiveEnabled: false },
      });
      await tx.microsoftTeamsInstallation.updateMany({ data: { enabled: false } });
      await tx.microsoftTeamsDestination.updateMany({
        data: { enabled: false, interactiveEnabled: false },
      });
    }

    await emitAuditEvent(
      {
        action: 'microsoftTeams.integration.disconnected',
        source: 'UI',
        target: { type: 'SYSTEM_CONFIG', id: 'microsoft-teams' },
        actor: { type: 'USER', id: actorId },
        metadata: {
          destinationsAffected: destinations.length,
          servicesUpdated: routedServices.length,
          operationsRevoked: revoked.operationIds.length,
          jobsCancelled: revoked.jobsCancelled,
          warRoomsRevoked: revokedWarRooms.warRoomIds.length,
          warRoomJobsCancelled: revokedWarRooms.jobsCancelled,
          deleted: deleteConfig,
        },
      },
      tx
    );
  });
  clearMicrosoftTeamsTokenCaches();
}
