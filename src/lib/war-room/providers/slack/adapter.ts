import type { WarRoomProviderAdapter, WarRoomIncidentEvent } from '../../provider';

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

  const lifecycle = await import('./lifecycle');
  let result: { success: boolean; error?: string };
  switch (event.kind) {
    case 'ARCHIVE':
      result = await lifecycle.archiveSlackWarRoomChannel(event.incidentId);
      break;
    case 'LIFECYCLE': {
      const [message, topic] = await Promise.all([
        lifecycle.postSlackWarRoomUpdate(event.incidentId, event.message),
        lifecycle.updateSlackWarRoomTopic(event.incidentId, event.status),
      ]);
      result = !message.success ? message : topic;
      // Also refresh the canonical card via durable projection so status/assignee
      // changes are reflected provider-neutrally. Best-effort: do not fail lifecycle
      // if projection queue is momentarily unavailable — the card will be
      // reconciled on next incident change.
      try {
        const { requestSlackWarRoomProjectionForIncident } = await import('./projection');
        await requestSlackWarRoomProjectionForIncident(event.incidentId);
      } catch {}
      break;
    }
    case 'MESSAGE':
      result = await lifecycle.postSlackWarRoomUpdate(event.incidentId, event.message);
      try {
        const { requestSlackWarRoomProjectionForIncident } = await import('./projection');
        await requestSlackWarRoomProjectionForIncident(event.incidentId);
      } catch {}
      break;
    case 'TOPIC':
      result = await lifecycle.updateSlackWarRoomTopic(event.incidentId, event.status);
      try {
        const { requestSlackWarRoomProjectionForIncident } = await import('./projection');
        await requestSlackWarRoomProjectionForIncident(event.incidentId);
      } catch {}
      break;
    case 'INVITE_USER':
      result = await lifecycle.inviteUserToSlackWarRoom(event.incidentId, event.userId);
      break;
    case 'INVITE_TEAM':
      result = await lifecycle.inviteTeamToSlackWarRoom(event.incidentId, event.teamId);
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
  project: async (warRoomId, projectionVersion) => {
    const { projectSlackWarRoomCard } = await import('./projection');
    await projectSlackWarRoomCard(warRoomId, projectionVersion);
  },
  syncParticipants: async warRoomId => {
    const { syncSlackWarRoomParticipants } = await import('../../slack-participants');
    await syncSlackWarRoomParticipants(warRoomId);
  },
  settleProjectionFailure: async (warRoomId, projectionVersion) => {
    const { settleSlackWarRoomProjectionFailure } = await import('./projection');
    await settleSlackWarRoomProjectionFailure(warRoomId, projectionVersion);
  },
  reconcile: async warRoomId => {
    const { reconcileSlackWarRoom } = await import('./health');
    await reconcileSlackWarRoom(warRoomId);
  },
  handleIncidentEvent,
};
