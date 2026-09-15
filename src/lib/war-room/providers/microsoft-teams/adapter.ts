import { provisionMicrosoftTeamsWarRoom } from './provision';
import { syncMicrosoftTeamsWarRoomParticipants } from './participants';
import { projectMicrosoftTeamsWarRoomCard, settleWarRoomProjectionFailure } from './projection';
import type { WarRoomIncidentEvent, WarRoomProviderAdapter } from '../../provider';

async function handleIncidentEvent(event: WarRoomIncidentEvent) {
  const teams = await import('./provision');
  const projection = await import('./projection');
  const participants = await import('./participants');
  switch (event.kind) {
    case 'TRIGGER':
      await teams.requestMicrosoftTeamsWarRoom(event.incidentId, {
        manual: false,
        allowNewGeneration: false,
      });
      break;
    case 'ENSURE':
      await teams.requestMicrosoftTeamsWarRoom(event.incidentId, {
        manual: false,
        allowNewGeneration: true,
      });
      break;
    case 'ARCHIVE': {
      // Neutral durable close already handled pre-create fencing (PROVISIONING/AMBIGUOUS) in provision.ts path.
      // Here we only need the READY→CLOSING durable close; reuse the neutral engine so invariants match resolve path.
      const { closeIncidentWarRoomsNeutral } = await import('../../engine');
      await closeIncidentWarRoomsNeutral(event.incidentId);
      break;
    }
    case 'INVITE_USER':
    case 'INVITE_TEAM':
      await Promise.all([
        projection.requestMicrosoftTeamsWarRoomProjectionForIncident(event.incidentId),
        participants.requestMicrosoftTeamsWarRoomParticipantSyncForIncident(event.incidentId),
      ]);
      break;
    case 'LIFECYCLE':
    case 'MESSAGE':
    case 'TOPIC':
      await projection.requestMicrosoftTeamsWarRoomProjectionForIncident(event.incidentId);
      break;
  }
  return { ok: true as const, value: undefined };
}

export const microsoftTeamsWarRoomAdapter: WarRoomProviderAdapter = {
  provider: 'MICROSOFT_TEAMS',
  capabilities: {
    createRoom: true,
    privateRooms: true,
    manageMembers: true,
    updateRoom: true,
    archiveRoom: false,
    interactiveProjection: true,
    projectionUpdates: true,
    reconciliation: true,
  },
  provision: provisionMicrosoftTeamsWarRoom,
  project: projectMicrosoftTeamsWarRoomCard,
  syncParticipants: syncMicrosoftTeamsWarRoomParticipants,
  settleProjectionFailure: settleWarRoomProjectionFailure,
  reconcile: async warRoomId => {
    const prisma = (await import('@/lib/prisma')).default;
    const room = await prisma.incidentWarRoom.findUnique({
      where: { id: warRoomId },
      select: { provider: true },
    });
    if (!room || room.provider !== 'MICROSOFT_TEAMS') return;

    const full = await prisma.incidentWarRoom.findUnique({
      where: { id: warRoomId },
      include: { incident: { select: { id: true } } },
    });
    if (!full || !full.providerTenantId || !full.providerContainerId) {
      await prisma.incidentWarRoom.updateMany({ where: { id: warRoomId }, data: { lastReconciledAt: new Date() } });
      return;
    }
    const { getChannelById, findWarRoomChannel, warRoomMarker } = await import('@/lib/microsoft-teams/graph/channels');
    let result: Awaited<ReturnType<typeof getChannelById>> | Awaited<ReturnType<typeof findWarRoomChannel>>;
    if (full.providerChannelId) {
      const direct = await getChannelById({ tenantId: full.providerTenantId, teamId: full.providerContainerId, channelId: full.providerChannelId });
      if (!direct.ok) result = direct;
      else if (direct.value) {
        const hasMarker = direct.value.description?.includes(warRoomMarker(full.incident.id, full.generation));
        result = hasMarker ? direct : await findWarRoomChannel({ tenantId: full.providerTenantId, teamId: full.providerContainerId, marker: warRoomMarker(full.incident.id, full.generation) });
      } else {
        result = await findWarRoomChannel({ tenantId: full.providerTenantId, teamId: full.providerContainerId, marker: warRoomMarker(full.incident.id, full.generation) });
      }
    } else {
      result = await findWarRoomChannel({ tenantId: full.providerTenantId, teamId: full.providerContainerId, marker: warRoomMarker(full.incident.id, full.generation) });
    }
    const health = result.ok && result.value ? 'HEALTHY' : !result.ok && result.code === 'MISSING_PERMISSION' ? 'PERMISSION_ERROR' : result.ok ? 'MISSING' : 'DEGRADED';
    await prisma.incidentWarRoom.update({
      where: { id: warRoomId },
      data: {
        health,
        lastReconciledAt: new Date(),
        ...(health === 'HEALTHY' ? {} : { lastErrorCode: result.ok ? 'CHANNEL_MISSING' : result.code, lastError: result.ok ? 'The Teams war-room marker was not found during health reconciliation.' : result.message }),
      },
    });
  },
  handleIncidentEvent,
  // Teams has archiveRoom=false — engine treats CLOSED as terminal without external archive.
};
