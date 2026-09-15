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

async function handleIncidentEvent(event: WarRoomIncidentEvent, context?: { deliveryId?: string; deliveryLeaseToken?: string; idempotencyKey?: string }) {
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
  const deliveryLeaseToken = context?.deliveryLeaseToken ?? null;
  let stageApi: typeof import('../../delivery') | null = null;
  if (deliveryId) {
    try { stageApi = await import('../../delivery'); } catch {}
  }
  const stageCompleted = async (stage: string) => {
    if (!deliveryId || !stageApi) return false;
    try { return await stageApi.stageAlreadyCompleted(deliveryId, stage); } catch { return false; }
  };
  const stageIsAmbiguous = async (stage: string) => {
    if (!deliveryId || !stageApi) return false;
    try {
      const s = await stageApi.getWarRoomStage(deliveryId, stage);
      return s?.status === 'AMBIGUOUS';
    } catch { return false; }
  };
  // Fenced execution: begin stage atomically → call provider → COMPLETED | AMBIGUOUS | FAILED.
  // If fencing DB is down we fail-closed (do not call provider). Stale ATTEMPTING that never
  // completed is treated as AMBIGUOUS — never re-posted blindly.
  const runFencedStage = async (
    stage: string,
    providerCall: () => Promise<{ success: boolean; error?: string; sideEffectAmbiguous?: boolean; transportFailure?: boolean; httpStatus?: number }>
  ): Promise<{ success: boolean; error?: string; sideEffectAmbiguous?: boolean } | { __fenced: true } | { __ambiguous: true; error: string }> => {
    if (!deliveryId || !stageApi) {
      return providerCall();
    }
    if (await stageCompleted(stage)) return { success: true };
    if (await stageIsAmbiguous(stage)) return { __ambiguous: true, error: 'Stage is ambiguous; reconciling before retry.' } as const;
    // Pre-flight lease check — fail-closed if DB unavailable (throw retryable)
    if (deliveryLeaseToken) {
      const { validateDeliveryLease } = await import('../../delivery');
      let ok: boolean;
      try { ok = await validateDeliveryLease(deliveryId, deliveryLeaseToken); } catch (e) { throw e; }
      if (!ok) return { __fenced: true } as const;
    }
    // Atomically claim stage — fail-closed on DB error (do not fall through to providerCall)
    let claimed: { claimed: boolean; operationId: string; stageLeaseToken: string };
    try {
      claimed = await stageApi.claimWarRoomStageAttempt(deliveryId, stage, deliveryLeaseToken ?? undefined);
    } catch (e) {
      throw e;
    }
    if (!claimed.claimed) {
      const isCompleted = await stageApi.stageAlreadyCompleted(deliveryId, stage);
      if (isCompleted) return { success: true };
      if (await stageIsAmbiguous(stage)) return { __ambiguous: true, error: 'Stage is ambiguous; reconciling before retry.' } as const;
      return { __fenced: true } as const;
    }
    const { operationId, stageLeaseToken } = claimed;
    // Perform provider operation once
    const res = await providerCall();
    // Ambiguous transport (timeout/network) — settlement must be considered successful side-effect, never retried blindly
    const ambiguousTransport = res.sideEffectAmbiguous || res.transportFailure || (res.httpStatus != null && res.httpStatus >= 500 && !res.success);
    // Validate lease freshness before committing outcome — stale worker must not settle
    if (deliveryLeaseToken) {
      try {
        const { validateDeliveryLease } = await import('../../delivery');
        const stillValid = await validateDeliveryLease(deliveryId, deliveryLeaseToken);
        if (!stillValid) {
          try { await stageApi.markStageAmbiguous(deliveryId, stage, 'Delivery lease lost after provider call; treating stage as ambiguous.', operationId, stageLeaseToken); } catch {}
          return { __fenced: true } as const;
        }
      } catch {}
    }
    if (res.success) {
      try { await stageApi.completeWarRoomStage(deliveryId, stage, deliveryLeaseToken ?? undefined, operationId, stageLeaseToken); } catch {}
      return res;
    }
    if (res.sideEffectAmbiguous || ambiguousTransport) {
      try { await stageApi.markStageAmbiguous(deliveryId, stage, res.error ?? 'ambiguous', operationId, stageLeaseToken); } catch {}
      return { __ambiguous: true, error: res.error ?? 'Slack operation ambiguous' } as const;
    }
    try { await stageApi.failWarRoomStage(deliveryId, stage, res.error ?? 'failed', operationId, stageLeaseToken); } catch {}
    return res;
  };

  let result: { success: boolean; error?: string; sideEffectAmbiguous?: boolean };
  switch (event.kind) {
    case 'ARCHIVE': {
      // Provider-scoped durable close — SLACK delivery must never mutate
      // MICROSOFT_TEAMS rooms and vice versa. Global all-provider close is
      // still available via closeIncidentWarRoomsNeutral(incidentId) for
      // outbox-level code, but delivery handlers must be isolated.
      const { closeProviderWarRoomsNeutral } = await import('../../engine');
      await closeProviderWarRoomsNeutral(event.incidentId, 'SLACK');
      result = { success: true };
      break;
    }
    case 'LIFECYCLE': {
      const msgStage = 'slack:lifecycle:message';
      const topicStage = 'slack:lifecycle:topic';
      // Message stage — fenced
      const msgOutcome = await runFencedStage(msgStage, () => lifecycle.postSlackWarRoomUpdate(event.incidentId, event.message));
      if ('__fenced' in (msgOutcome as Record<string, unknown>)) {
        result = { success: true };
        break;
      }
      if ('__ambiguous' in (msgOutcome as Record<string, unknown>)) {
        const amb = msgOutcome as unknown as { __ambiguous: true; error: string };
        try {
          const prisma = (await import('@/lib/prisma')).default;
          const room = await prisma.incidentWarRoom.findFirst({ where: { incidentId: event.incidentId, provider: 'SLACK', state: { in: ['READY', 'CLOSING'] } }, select: { id: true } });
          if (room) await prisma.incidentWarRoom.updateMany({ where: { id: room.id }, data: { health: 'DEGRADED', lastErrorCode: 'AMBIGUOUS_SIDE_EFFECT', lastError: 'Slack timeline message outcome is ambiguous; reconciling before retry.' } });
        } catch {}
        return { ok: false as const, code: 'AMBIGUOUS_SIDE_EFFECT' as const, message: amb.error };
      }
      const msgRes = msgOutcome as { success: boolean; error?: string; sideEffectAmbiguous?: boolean };
      if (!msgRes.success) {
        result = msgRes;
        break;
      }
      // Topic stage — fenced
      const topicOutcome = await runFencedStage(topicStage, () => lifecycle.updateSlackWarRoomTopic(event.incidentId, event.status));
      if ('__fenced' in (topicOutcome as Record<string, unknown>)) {
        result = { success: true };
        break;
      }
      if ('__ambiguous' in (topicOutcome as Record<string, unknown>)) {
        const amb = topicOutcome as unknown as { __ambiguous: true; error: string };
        try {
          const prisma = (await import('@/lib/prisma')).default;
          const room = await prisma.incidentWarRoom.findFirst({ where: { incidentId: event.incidentId, provider: 'SLACK', state: { in: ['READY', 'CLOSING'] } }, select: { id: true } });
          if (room) await prisma.incidentWarRoom.updateMany({ where: { id: room.id }, data: { health: 'DEGRADED', lastErrorCode: 'AMBIGUOUS_SIDE_EFFECT', lastError: amb.error } });
        } catch {}
        return { ok: false as const, code: 'AMBIGUOUS_SIDE_EFFECT' as const, message: amb.error };
      }
      const topicRes = topicOutcome as { success: boolean; error?: string; sideEffectAmbiguous?: boolean };
      if (!topicRes.success) {
        result = topicRes;
        break;
      }
      result = { success: true };
      try {
        const { requestSlackWarRoomProjectionForIncident } = await import('./projection');
        await requestSlackWarRoomProjectionForIncident(event.incidentId);
      } catch {}
      break;
    }
    case 'MESSAGE': {
      const msgStage = 'slack:message';
      const msgOutcome = await runFencedStage(msgStage, () => lifecycle.postSlackWarRoomUpdate(event.incidentId, event.message));
      if ('__fenced' in (msgOutcome as Record<string, unknown>)) {
        result = { success: true };
        break;
      }
      if ('__ambiguous' in (msgOutcome as Record<string, unknown>)) {
        const amb = msgOutcome as unknown as { __ambiguous: true; error: string };
        try {
          const prisma = (await import('@/lib/prisma')).default;
          const room = await prisma.incidentWarRoom.findFirst({ where: { incidentId: event.incidentId, provider: 'SLACK', state: { in: ['READY', 'CLOSING'] } }, select: { id: true } });
          if (room) await prisma.incidentWarRoom.updateMany({ where: { id: room.id }, data: { health: 'DEGRADED', lastErrorCode: 'AMBIGUOUS_SIDE_EFFECT', lastError: 'Slack message outcome is ambiguous; reconciling before retry.' } });
        } catch {}
        return { ok: false as const, code: 'AMBIGUOUS_SIDE_EFFECT' as const, message: amb.error };
      }
      const msgRes = msgOutcome as { success: boolean; error?: string; sideEffectAmbiguous?: boolean };
      if (!msgRes.success) {
        result = msgRes;
        break;
      }
      result = { success: true };
      try {
        const { requestSlackWarRoomProjectionForIncident } = await import('./projection');
        await requestSlackWarRoomProjectionForIncident(event.incidentId);
      } catch {}
      break;
    }
    case 'TOPIC': {
      const topicStage = 'slack:topic';
      const topicOutcome = await runFencedStage(topicStage, () => lifecycle.updateSlackWarRoomTopic(event.incidentId, event.status));
      if ('__fenced' in (topicOutcome as Record<string, unknown>)) {
        result = { success: true };
        break;
      }
      if ('__ambiguous' in (topicOutcome as Record<string, unknown>)) {
        const amb = topicOutcome as unknown as { __ambiguous: true; error: string };
        return { ok: false as const, code: 'AMBIGUOUS_SIDE_EFFECT' as const, message: amb.error };
      }
      const topicRes = topicOutcome as { success: boolean; error?: string; sideEffectAmbiguous?: boolean };
      if (!topicRes.success) {
        result = topicRes;
        break;
      }
      result = { success: true };
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
  if ((result!).success || expectedSkips.some(reason => (result!).error?.includes(reason))) {
    return { ok: true as const, value: undefined };
  }
  if ((result!).sideEffectAmbiguous) {
    return { ok: false as const, code: 'AMBIGUOUS_SIDE_EFFECT' as const, message: (result!).error ?? 'Slack operation ambiguous' };
  }
  return {
    ok: false as const,
    code: 'TRANSIENT' as const,
    message: (result!).error ?? 'Slack war-room operation failed.',
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
  provision: async (warRoomId, provisioningToken, opts) => {
    const { provisionSlackWarRoom } = await import('./provision');
    await provisionSlackWarRoom(warRoomId, provisioningToken, opts);
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
  archive: async warRoomId => {
    const { archiveExternalSlackRoom } = await import('./lifecycle');
    const r = await archiveExternalSlackRoom(warRoomId);
    if (r.ok) return { ok: true as const, value: undefined };
    if (r.code === 'NOT_FOUND') return { ok: false as const, code: 'NOT_FOUND' as const, message: r.message ?? 'Archive failed' };
    if (r.code === 'AMBIGUOUS_SIDE_EFFECT') return { ok: false as const, code: 'AMBIGUOUS_SIDE_EFFECT' as const, message: r.message ?? 'Archive ambiguous' };
    if (r.code === 'RATE_LIMITED') return { ok: false as const, code: 'RATE_LIMITED' as const, message: r.message ?? 'Rate limited' };
    return { ok: false as const, code: 'TRANSIENT' as const, message: r.message ?? 'Archive failed' };
  },
  handleIncidentEvent,
};
