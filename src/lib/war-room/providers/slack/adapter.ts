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

async function handleIncidentEvent(event: WarRoomIncidentEvent, context?: { deliveryId?: string; idempotencyKey?: string }) {
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
  const deliveryId = context?.deliveryId ?? null;
  let stageApi: typeof import('../../delivery') | null = null;
  if (deliveryId) {
    try { stageApi = await import('../../delivery'); } catch {}
  }
  const stageCompleted = async (stage: string) => {
    if (!deliveryId || !stageApi) return false;
    try { return await stageApi.stageAlreadyCompleted(deliveryId, stage); } catch { return false; }
  };
  const markStageCompleted = async (stage: string) => {
    if (!deliveryId || !stageApi) return;
    try { await stageApi.ensureWarRoomStage(deliveryId, stage); await stageApi.completeWarRoomStage(deliveryId, stage); } catch {}
  };
  const markStageFailed = async (stage: string, err: string) => {
    if (!deliveryId || !stageApi) return;
    try { await stageApi.ensureWarRoomStage(deliveryId, stage); await stageApi.failWarRoomStage(deliveryId, stage, err); } catch {}
  };

  let result: { success: boolean; error?: string; sideEffectAmbiguous?: boolean };
  switch (event.kind) {
    case 'ARCHIVE':
      result = await lifecycle.archiveSlackWarRoomChannel(event.incidentId);
      break;
    case 'LIFECYCLE': {
      // Sequential staged settlement: message -> topic -> card projection.
      // Each stage is durably recorded so a retry never blind-reposts an ambiguous chat.postMessage.
      const msgStage = 'slack:lifecycle:message';
      const topicStage = 'slack:lifecycle:topic';
      if (deliveryId && await stageCompleted(msgStage)) {
        // Message already delivered — skip ambiguous re-POST.
      } else {
        const msg = await lifecycle.postSlackWarRoomUpdate(event.incidentId, event.message);
        if (!msg.success) {
          if (msg.sideEffectAmbiguous) {
            await markStageFailed(msgStage, msg.error ?? 'ambiguous chat.postMessage');
            // Mark delivery as needing reconciliation; do not retry blindly.
            try {
              const prisma = (await import('@/lib/prisma')).default;
              const room = await prisma.incidentWarRoom.findFirst({ where: { incidentId: event.incidentId, provider: 'SLACK', state: { in: ['READY', 'CLOSING'] } }, select: { id: true } });
              if (room) await prisma.incidentWarRoom.updateMany({ where: { id: room.id }, data: { health: 'DEGRADED', lastErrorCode: 'AMBIGUOUS_SIDE_EFFECT', lastError: 'Slack timeline message outcome is ambiguous; reconciling before retry.' } });
            } catch {}
            return { ok: false as const, code: 'AMBIGUOUS_SIDE_EFFECT' as const, message: msg.error ?? 'Slack timeline message ambiguous' };
          }
          result = msg;
          break;
        }
        await markStageCompleted(msgStage);
      }
      if (deliveryId && await stageCompleted(topicStage)) {
        result = { success: true };
      } else {
        const topic = await lifecycle.updateSlackWarRoomTopic(event.incidentId, event.status);
        if (!topic.success) {
          await markStageFailed(topicStage, topic.error ?? 'topic update failed');
          result = topic;
          break;
        }
        await markStageCompleted(topicStage);
        result = { success: true };
      }
      try {
        const { requestSlackWarRoomProjectionForIncident } = await import('./projection');
        await requestSlackWarRoomProjectionForIncident(event.incidentId);
      } catch {}
      // Projection is async; lifecycle delivery is complete once message+topic settled.
      break;
    }
    case 'MESSAGE': {
      const msgStage = 'slack:message';
      if (deliveryId && await stageCompleted(msgStage)) {
        result = { success: true };
      } else {
        const msg = await lifecycle.postSlackWarRoomUpdate(event.incidentId, event.message);
        if (!msg.success) {
          if (msg.sideEffectAmbiguous) {
            await markStageFailed(msgStage, msg.error ?? 'ambiguous chat.postMessage');
            try {
              const prisma = (await import('@/lib/prisma')).default;
              const room = await prisma.incidentWarRoom.findFirst({ where: { incidentId: event.incidentId, provider: 'SLACK', state: { in: ['READY', 'CLOSING'] } }, select: { id: true } });
              if (room) await prisma.incidentWarRoom.updateMany({ where: { id: room.id }, data: { health: 'DEGRADED', lastErrorCode: 'AMBIGUOUS_SIDE_EFFECT', lastError: 'Slack message outcome is ambiguous; reconciling before retry.' } });
            } catch {}
            return { ok: false as const, code: 'AMBIGUOUS_SIDE_EFFECT' as const, message: msg.error ?? 'Slack message ambiguous' };
          }
          result = msg;
          break;
        }
        await markStageCompleted(msgStage);
        result = { success: true };
      }
      try {
        const { requestSlackWarRoomProjectionForIncident } = await import('./projection');
        await requestSlackWarRoomProjectionForIncident(event.incidentId);
      } catch {}
      break;
    }
    case 'TOPIC': {
      const topicStage = 'slack:topic';
      if (deliveryId && await stageCompleted(topicStage)) {
        result = { success: true };
      } else {
        const topic = await lifecycle.updateSlackWarRoomTopic(event.incidentId, event.status);
        if (!topic.success) {
          await markStageFailed(topicStage, topic.error ?? 'topic update failed');
          result = topic;
          break;
        }
        await markStageCompleted(topicStage);
        result = { success: true };
      }
      try {
        const { requestSlackWarRoomProjectionForIncident } = await import('./projection');
        await requestSlackWarRoomProjectionForIncident(event.incidentId);
      } catch {}
      break;
    }
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
  if (result.sideEffectAmbiguous) {
    return { ok: false as const, code: 'AMBIGUOUS_SIDE_EFFECT' as const, message: result.error ?? 'Slack operation ambiguous' };
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
