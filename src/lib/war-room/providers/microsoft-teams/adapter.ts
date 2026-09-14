import { provisionMicrosoftTeamsWarRoom } from '../../microsoft-teams';
import { syncMicrosoftTeamsWarRoomParticipants } from '../../participants';
import { projectMicrosoftTeamsWarRoomCard, settleWarRoomProjectionFailure } from '../../projection';
import type { WarRoomProviderAdapter } from '../../provider';

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
};
