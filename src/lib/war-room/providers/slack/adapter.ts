import {
  UnsupportedWarRoomProviderOperationError,
  type WarRoomProviderAdapter,
} from '../../provider';

function unsupported(operation: string): never {
  throw new UnsupportedWarRoomProviderOperationError('SLACK', operation);
}

/**
 * Registration point for the Slack migration. It fails closed until Slack's
 * legacy incident-column authority has been backfilled into IncidentWarRoom.
 */
export const slackWarRoomAdapter: WarRoomProviderAdapter = {
  provider: 'SLACK',
  capabilities: {
    createRoom: false,
    privateRooms: false,
    manageMembers: false,
    updateRoom: false,
    archiveRoom: false,
    interactiveProjection: false,
    projectionUpdates: false,
    reconciliation: false,
  },
  provision: async () => unsupported('provision'),
  project: async () => unsupported('project'),
  syncParticipants: async () => unsupported('syncParticipants'),
  settleProjectionFailure: async () => unsupported('settleProjectionFailure'),
};
