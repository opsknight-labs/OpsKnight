import 'server-only';

import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { evaluateWarRoomPolicy } from './policy';
import { claimWarRoomProvisioning, markWarRoomReady } from './repository';
import { createChannel, findWarRoomChannel, warRoomChannelName, warRoomMarker } from '@/lib/microsoft-teams/graph/channels';

type RequestResult = { accepted: true; warRoomId: string; state: string } | { accepted: false; code: string };

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
      tx.microsoftTeamsDestination.findFirst({ where: { serviceId: incident.serviceId, enabled: true, warRoomEnabled: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const decision = evaluateWarRoomPolicy({
      incident: { urgency: incident.urgency, priority: incident.priority, visibility: incident.visibility },
      service: { autoCreate: incident.service.microsoftTeamsWarRoomAutoCreate },
      destination: destination ? { enabled: destination.enabled, warRoomEnabled: destination.warRoomEnabled, autoCreate: destination.warRoomAutoCreate, membershipType: destination.warRoomMembershipType } : null,
      config: { enabled: Boolean(chatOpsConfig?.enabled), warRoomsEnabled: Boolean(config?.warRoomsEnabled), autoCreateOnUrgency: chatOpsConfig?.autoCreateOnUrgency ?? [], autoCreateOnPriority: chatOpsConfig?.autoCreateOnPriority ?? [], defaultMembershipType: config?.defaultWarRoomMembershipType ?? 'STANDARD' },
      manual,
    });
    if (!decision.allowed || !destination) return { accepted: false, code: decision.allowed ? 'DESTINATION_UNAVAILABLE' : decision.code };
    const claimed = await claimWarRoomProvisioning(tx, { incidentId, provider: 'MICROSOFT_TEAMS' });
    if (claimed.claimed) {
      await tx.incidentWarRoom.update({ where: { id: claimed.warRoom.id }, data: { providerTenantId: destination.tenantId, providerContainerId: destination.teamId, membershipType: decision.membershipType } });
      await tx.backgroundJob.create({ data: { type: 'WAR_ROOM_PROVISION', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 6, payload: { warRoomId: claimed.warRoom.id } } });
    }
    return { accepted: true, warRoomId: claimed.warRoom.id, state: claimed.warRoom.state };
  });
}

/** Worker entry point. A create timeout is left AMBIGUOUS and reconciled by marker. */
export async function provisionMicrosoftTeamsWarRoom(warRoomId: string): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId }, include: { incident: { select: { id: true, title: true } } } });
  if (!room || room.provider !== 'MICROSOFT_TEAMS' || room.state !== 'PROVISIONING' || !room.provisioningToken || !room.providerTenantId || !room.providerContainerId || !room.membershipType) return;
  const marker = warRoomMarker(room.incident.id, room.generation);
  const existing = await findWarRoomChannel({ tenantId: room.providerTenantId, teamId: room.providerContainerId, marker });
  if (existing.ok && existing.value) {
    await runSerializableTransaction(tx => markWarRoomReady(tx, { warRoomId: room.id, provisioningToken: room.provisioningToken!, tenantId: room.providerTenantId!, teamId: room.providerContainerId!, channelId: existing.value!.id, channelName: existing.value!.displayName, channelUrl: existing.value!.webUrl }));
    return;
  }
  if (!existing.ok && existing.code !== 'AMBIGUOUS_CREATE') return markFailed(room.id, existing.code, existing.message);
  const created = await createChannel({ tenantId: room.providerTenantId, teamId: room.providerContainerId, displayName: warRoomChannelName(room.incident.id, room.incident.title), description: marker, membershipType: room.membershipType });
  if (!created.ok) {
    if (created.code === 'AMBIGUOUS_CREATE') await prisma.incidentWarRoom.update({ where: { id: room.id }, data: { state: 'AMBIGUOUS', lastErrorCode: created.code, lastError: created.message } });
    else await markFailed(room.id, created.code, created.message);
    return;
  }
  const adopted = await runSerializableTransaction(tx => markWarRoomReady(tx, { warRoomId: room.id, provisioningToken: room.provisioningToken!, tenantId: room.providerTenantId!, teamId: room.providerContainerId!, channelId: created.value.id, channelName: created.value.displayName, channelUrl: created.value.webUrl }));
  if (!adopted) await prisma.incidentWarRoom.update({ where: { id: room.id }, data: { state: 'AMBIGUOUS', lastErrorCode: 'DATABASE_COMMIT_FAILED', lastError: 'Channel may have been created; reconcile by marker before retrying.' } });
}

async function markFailed(id: string, code: string, message: string): Promise<void> {
  await prisma.incidentWarRoom.update({ where: { id }, data: { state: 'FAILED', lastErrorCode: code, lastError: message.slice(0, 1000), provisioningToken: null } });
}
