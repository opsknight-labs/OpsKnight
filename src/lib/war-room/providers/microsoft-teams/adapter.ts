import { provisionMicrosoftTeamsWarRoom } from '../../microsoft-teams';
import { syncMicrosoftTeamsWarRoomParticipants } from '../../participants';
import { projectMicrosoftTeamsWarRoomCard, settleWarRoomProjectionFailure } from '../../projection';
import type { WarRoomIncidentEvent, WarRoomProviderAdapter } from '../../provider';

async function handleIncidentEvent(event: WarRoomIncidentEvent) {
  const teams = await import('../../microsoft-teams');
  const projection = await import('../../projection');
  const participants = await import('../../participants');
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
    case 'ARCHIVE':
      await teams.settleMicrosoftTeamsWarRoomsOnIncidentResolve(event.incidentId);
      break;
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
  handleIncidentEvent,
};
