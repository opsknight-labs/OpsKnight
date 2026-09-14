import {
  UnsupportedWarRoomProviderOperationError,
  type WarRoomProviderAdapter,
  type WarRoomIncidentEvent,
} from '../../provider';

function unsupported(operation: string): never {
  throw new UnsupportedWarRoomProviderOperationError('SLACK', operation);
}

const expectedSkips = [
  'Incident not found',
  'ChatOps is not enabled',
  'auto-creation disabled',
  'does not meet urgency/priority threshold',
  'No war-room channel',
  'No active war-room channel',
  'War-room channel is archived',
  'Archive on resolve is disabled',
  'No Slack bot token',
  'not configured',
  'already_archived',
  'channel_not_found',
];

const expectedSlackRequestSkips = new Set([
  'INCIDENT_NOT_FOUND',
  'INCIDENT_NOT_ACTIVE',
  'CHATOPS_DISABLED',
  'WAR_ROOMS_DISABLED',
  'DESTINATION_UNAVAILABLE',
  'SERVICE_DISABLED',
  'AUTO_CREATE_DISABLED',
  'THRESHOLD_NOT_MET',
  'PRIVATE_DOWNGRADE_DENIED',
]);

async function handleIncidentEvent(event: WarRoomIncidentEvent) {
  if (event.kind === 'TRIGGER' || event.kind === 'ENSURE') {
    const { requestSlackWarRoom } = await import('./provision');
    const result = await requestSlackWarRoom(event.incidentId, {
      manual: false,
      allowNewGeneration: event.kind === 'ENSURE',
    });
    if (result.accepted) return { ok: true as const, value: undefined };
    if (expectedSlackRequestSkips.has(result.code)) return { ok: true as const, value: undefined };
    return { ok: false as const, code: 'TRANSIENT' as const, message: result.code };
  }

  const slack = await import('@/lib/chatops/war-room');
  let result: { success: boolean; error?: string };
  switch (event.kind) {
    case 'ARCHIVE':
      result = await slack.archiveWarRoomChannel(event.incidentId);
      break;
    case 'LIFECYCLE': {
      const [message, topic] = await Promise.all([
        slack.postWarRoomUpdate(event.incidentId, event.message),
        slack.updateWarRoomTopic(event.incidentId, event.status),
      ]);
      result = !message.success ? message : topic;
      break;
    }
    case 'MESSAGE':
      result = await slack.postWarRoomUpdate(event.incidentId, event.message);
      break;
    case 'TOPIC':
      result = await slack.updateWarRoomTopic(event.incidentId, event.status);
      break;
    case 'INVITE_USER':
      result = await slack.inviteUserToWarRoom(event.incidentId, event.userId);
      break;
    case 'INVITE_TEAM':
      result = await slack.inviteTeamToWarRoom(event.incidentId, event.teamId);
      break;
    default:
      return { ok: true as const, value: undefined };
  }
  if (result.success || expectedSkips.some(reason => result.error?.includes(reason))) {
    return { ok: true as const, value: undefined };
  }
  return {
    ok: false as const,
    code: 'TRANSIENT' as const,
    message: result.error ?? 'Slack war-room operation failed.',
  };
}

/**
 * Registration point for the Slack migration. It fails closed until Slack's
 * legacy incident-column authority has been backfilled into IncidentWarRoom.
 */
export const slackWarRoomAdapter: WarRoomProviderAdapter = {
  provider: 'SLACK',
  capabilities: {
    createRoom: true,
    privateRooms: false,
    manageMembers: true,
    updateRoom: true,
    archiveRoom: true,
    interactiveProjection: true,
    projectionUpdates: true,
    reconciliation: true,
  },
  provision: async (warRoomId, provisioningToken) => {
    const { provisionSlackWarRoom } = await import('./provision');
    await provisionSlackWarRoom(warRoomId, provisioningToken);
  },
  project: async () => unsupported('project'),
  syncParticipants: async warRoomId => {
    const { syncSlackWarRoomParticipants } = await import('../../slack-participants');
    await syncSlackWarRoomParticipants(warRoomId);
  },
  settleProjectionFailure: async () => unsupported('settleProjectionFailure'),
  handleIncidentEvent,
};
