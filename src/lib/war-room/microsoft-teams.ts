import 'server-only';

import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { evaluateWarRoomPolicy } from './policy';
import { claimWarRoomProvisioning, closeWarRoom, markWarRoomReady } from './repository';
import { createChannel, findWarRoomChannel, warRoomChannelName, warRoomMarker } from '@/lib/microsoft-teams/graph/channels';
import { getMicrosoftTeamsCapabilities } from '@/lib/microsoft-teams/capabilities';
import crypto from 'crypto';

type RequestResult = { accepted: true; warRoomId: string; state: string } | { accepted: false; code: string };
const AMBIGUOUS_RECONCILIATION_WINDOW_MS = 15 * 60_000;

export class WarRoomRetryableError extends Error {
  constructor(message: string, readonly retryAfterMs?: number, readonly retryBudgetNeutral = false) { super(message); this.name = 'WarRoomRetryableError'; }
}

/**
 * Durable request boundary. It deliberately makes no Microsoft request: callers
 * can retry it safely and a worker can provision the leased record afterwards.
 */
export async function requestMicrosoftTeamsWarRoom(incidentId: string, manual: boolean): Promise<RequestResult> {
  return runSerializableTransaction(async tx => {
    const incident = await tx.incident.findUnique({ where: { id: incidentId }, include: { service: { select: { microsoftTeamsWarRoomAutoCreate: true } } } });
    if (!incident) return { accepted: false, code: 'INCIDENT_NOT_FOUND' };
    const [config, chatOpsConfig, destination] = await Promise.all([
      tx.microsoftTeamsConfig.findFirst({ where: { enabled: true }, orderBy: { updatedAt: 'desc' } }),
      tx.chatOpsConfig.findUnique({ where: { id: 'default' } }),
      tx.microsoftTeamsDestination.findFirst({ where: { serviceId: incident.serviceId, enabled: true, warRoomEnabled: true, installation: { is: { enabled: true } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const decision = evaluateWarRoomPolicy({
      incident: { urgency: incident.urgency, priority: incident.priority, visibility: incident.visibility },
      service: { autoCreate: incident.service.microsoftTeamsWarRoomAutoCreate },
      destination: destination ? { enabled: destination.enabled, warRoomEnabled: destination.warRoomEnabled, autoCreate: destination.warRoomAutoCreate, membershipType: destination.warRoomMembershipType } : null,
      config: { enabled: Boolean(chatOpsConfig?.enabled), warRoomsEnabled: Boolean(config?.warRoomsEnabled), autoCreateOnUrgency: chatOpsConfig?.autoCreateOnUrgency ?? [], autoCreateOnPriority: chatOpsConfig?.autoCreateOnPriority ?? [], defaultMembershipType: config?.defaultWarRoomMembershipType ?? 'STANDARD' },
      manual,
    });
    if (!decision.allowed || !destination || !destination.installationId) return { accepted: false, code: decision.allowed ? 'DESTINATION_UNAVAILABLE' : decision.code };
    // Private Teams channels need an explicit owner and initial membership.
    // Until that capability is implemented, fail closed rather than creating a
    // channel that may be inaccessible or have incorrect ownership.
    if (decision.membershipType === 'PRIVATE') return { accepted: false, code: 'PRIVATE_WAR_ROOM_NOT_IMPLEMENTED' };
    const claimed = await claimWarRoomProvisioning(tx, { incidentId, provider: 'MICROSOFT_TEAMS', reopen: true });
    if (claimed.claimed) {
      await tx.incidentWarRoom.updateMany({ where: { id: claimed.warRoom.id, destinationId: null }, data: { destinationId: destination.id, installationId: destination.installationId, providerTenantId: destination.tenantId, providerContainerId: destination.teamId, membershipType: decision.membershipType } });
      await tx.backgroundJob.create({ data: { type: 'WAR_ROOM_PROVISION', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 6, payload: { warRoomId: claimed.warRoom.id, provisioningToken: claimed.warRoom.provisioningToken } } });
    }
    return { accepted: true, warRoomId: claimed.warRoom.id, state: claimed.warRoom.state };
  });
}

/**
 * Close the local command surface first. Microsoft Graph archival is an
 * optional lifecycle capability and must never delay incident containment;
 * reopening therefore always creates a new immutable generation.
 */
export async function closeMicrosoftTeamsWarRoom(incidentId: string, warRoomId: string): Promise<{ closed: boolean }> {
  const closed = await runSerializableTransaction(tx => closeWarRoom(tx, {
    incidentId, warRoomId, provider: 'MICROSOFT_TEAMS',
  }));
  return { closed };
}

/** Lifecycle worker close: settle all known-ready Team rooms locally on resolve. */
export async function closeActiveMicrosoftTeamsWarRooms(incidentId: string): Promise<number> {
  const result = await prisma.incidentWarRoom.updateMany({
    where: { incidentId, provider: 'MICROSOFT_TEAMS', state: 'READY' },
    data: { state: 'CLOSED', closedAt: new Date(), provisioningToken: null },
  });
  return result.count;
}

/** Worker entry point. Every retry reconciles this same generation before POST. */
export async function provisionMicrosoftTeamsWarRoom(warRoomId: string, expectedProvisioningToken: string): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId }, include: { incident: { select: { id: true, title: true, status: true } } } });
  if (!room || room.provisioningToken !== expectedProvisioningToken || room.provider !== 'MICROSOFT_TEAMS' || !['PROVISIONING', 'AMBIGUOUS'].includes(room.state) || !room.provisioningToken || !room.providerTenantId || !room.providerContainerId || !room.membershipType) return;
  const marker = warRoomMarker(room.incident.id, room.generation);
  const existing = await findWarRoomChannel({ tenantId: room.providerTenantId, teamId: room.providerContainerId, marker });
  if (existing.ok && existing.value) {
    const adopted = await runSerializableTransaction(tx => markWarRoomReady(tx, { warRoomId: room.id, provisioningToken: room.provisioningToken!, tenantId: room.providerTenantId!, teamId: room.providerContainerId!, channelId: existing.value!.id, channelName: existing.value!.displayName, channelUrl: existing.value!.webUrl }));
    if (adopted) {
      const { projectMicrosoftTeamsWarRoomParticipants } = await import('./participants');
      await projectMicrosoftTeamsWarRoomParticipants(room.id);
    }
    return;
  }
  // A failed or incomplete read is never evidence that a room is absent.
  if (!existing.ok) {
    if (existing.code === 'TRANSIENT_READ' || existing.code === 'RATE_LIMITED' || existing.code === 'GRAPH_TOKEN_FAILED') throw new WarRoomRetryableError(existing.message, existing.retryAfterMs);
    await markFailed(room.id, expectedProvisioningToken, existing.code, existing.message);
    return;
  }
  // A negative reconciliation never authorizes a second POST after an unknown
  // create outcome. Such rooms are reconciliation-only until an operator
  // resolves the ambiguity.
  if (room.createAttemptedAt) {
    const deadline = room.createAttemptedAt.getTime() + AMBIGUOUS_RECONCILIATION_WINDOW_MS;
    const remaining = deadline - Date.now();
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, provisioningToken: expectedProvisioningToken, state: { in: ['PROVISIONING', 'AMBIGUOUS'] } },
      data: {
        state: 'AMBIGUOUS',
        lastErrorCode: remaining > 0 ? 'CREATE_OUTCOME_RECONCILING' : 'CREATE_OUTCOME_UNRESOLVED',
        lastError: remaining > 0
          ? 'A prior Teams channel-create may have succeeded; reconciling by marker only.'
          : 'Teams channel-create outcome remains unresolved after the reconciliation window; operator reconciliation is required.',
      },
    });
    if (remaining > 0) {
      throw new WarRoomRetryableError('Reconciling an ambiguous Teams channel-create outcome by marker only.', Math.min(60_000, remaining), true);
    }
    return;
  }
  if (room.membershipType !== 'STANDARD') return markFailed(room.id, expectedProvisioningToken, 'PRIVATE_WAR_ROOM_NOT_IMPLEMENTED', 'Private Teams war rooms require an owner and initial members.');
  // A superseding retry can rotate the lease while this worker was reading
  // channels. Recheck immediately before the only non-idempotent side effect.
  const current = await prisma.incidentWarRoom.findUnique({ where: { id: room.id }, select: { provisioningToken: true, state: true } });
  if (!current || current.provisioningToken !== expectedProvisioningToken || !['PROVISIONING', 'AMBIGUOUS'].includes(current.state)) return;
  const authority = await validateWarRoomProvisioningAuthority(room);
  if (!authority.allowed) {
    if (room.state === 'AMBIGUOUS') return;
    await markFailed(room.id, expectedProvisioningToken, authority.code, authority.message);
    return;
  }
  // Keep the room lease aligned with this active queue worker immediately
  // before the POST. A concurrent manual request cannot reclaim the room
  // while this bounded (30s) Graph operation is in flight.
  const operationId = crypto.randomUUID();
  const renewed = await prisma.incidentWarRoom.updateMany({
    where: { id: room.id, provisioningToken: expectedProvisioningToken, state: { in: ['PROVISIONING', 'AMBIGUOUS'] } },
    data: { provisioningStartedAt: new Date(), createAttemptedAt: new Date(), createOperationId: operationId },
  });
  if (renewed.count !== 1) return;
  const created = await createChannel({ tenantId: room.providerTenantId, teamId: room.providerContainerId, displayName: warRoomChannelName(room.incident.id, room.generation, room.incident.title), description: marker, membershipType: 'STANDARD' });
  if (!created.ok) {
    if (created.code === 'AMBIGUOUS_CREATE') {
      await prisma.incidentWarRoom.updateMany({ where: { id: room.id, provisioningToken: room.provisioningToken }, data: { state: 'AMBIGUOUS', lastErrorCode: created.code, lastError: created.message } });
      throw new WarRoomRetryableError(created.message, created.retryAfterMs);
    }
    if (created.code === 'RATE_LIMITED' || created.code === 'GRAPH_TOKEN_FAILED' || created.code === 'TRANSIENT_READ') throw new WarRoomRetryableError(created.message, created.retryAfterMs);
    await markFailed(room.id, expectedProvisioningToken, created.code, created.message);
    return;
  }
  const adopted = await runSerializableTransaction(tx => markWarRoomReady(tx, { warRoomId: room.id, provisioningToken: room.provisioningToken!, tenantId: room.providerTenantId!, teamId: room.providerContainerId!, channelId: created.value.id, channelName: created.value.displayName, channelUrl: created.value.webUrl }));
  if (adopted) {
    const { projectMicrosoftTeamsWarRoomParticipants } = await import('./participants');
    await projectMicrosoftTeamsWarRoomParticipants(room.id);
  }
  if (!adopted) await prisma.incidentWarRoom.updateMany({ where: { id: room.id, provisioningToken: expectedProvisioningToken, state: { in: ['PROVISIONING', 'AMBIGUOUS'] } }, data: { state: 'AMBIGUOUS', lastErrorCode: 'DATABASE_COMMIT_FAILED', lastError: 'Channel may have been created; reconcile by marker before retrying.' } });
}

async function markFailed(id: string, provisioningToken: string, code: string, message: string): Promise<void> {
  await prisma.incidentWarRoom.updateMany({ where: { id, provisioningToken, state: { in: ['PROVISIONING', 'AMBIGUOUS'] } }, data: { state: 'FAILED', lastErrorCode: code, lastError: message.slice(0, 1000), provisioningToken: null } });
}

async function validateWarRoomProvisioningAuthority(room: { destinationId: string | null; installationId: string | null; providerTenantId: string | null; providerContainerId: string | null; incident: { status: string } }): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
  if (!['OPEN', 'ACKNOWLEDGED'].includes(room.incident.status)) return { allowed: false, code: 'INCIDENT_NOT_ACTIVE', message: 'Incident is no longer active.' };
  if (!room.destinationId) return { allowed: false, code: 'DESTINATION_SNAPSHOT_MISSING', message: 'War-room routing snapshot is missing.' };
  const [config, destination, installation] = await Promise.all([
    prisma.microsoftTeamsConfig.findFirst({ where: { enabled: true, warRoomsEnabled: true }, select: { id: true } }),
    prisma.microsoftTeamsDestination.findUnique({ where: { id: room.destinationId }, select: { enabled: true, warRoomEnabled: true, installationId: true } }),
    room.installationId ? prisma.microsoftTeamsInstallation.findUnique({ where: { id: room.installationId }, select: { enabled: true } }) : Promise.resolve(null),
  ]);
  if (!config || !destination?.enabled || !destination.warRoomEnabled || (room.installationId && (!installation?.enabled || destination.installationId !== room.installationId))) return { allowed: false, code: 'WAR_ROOM_AUTHORITY_REVOKED', message: 'Microsoft Teams war-room configuration or installation was disabled.' };
  const capabilities = await getMicrosoftTeamsCapabilities({ tenantId: room.providerTenantId ?? undefined, teamId: room.providerContainerId ?? undefined });
  if (!capabilities.canCreateWarRooms) return { allowed: false, code: 'WAR_ROOM_CAPABILITY_UNAVAILABLE', message: capabilities.failureReason ?? 'Microsoft Teams channel-create capability is unavailable.' };
  return { allowed: true };
}
