import 'server-only';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/env-validation';
import { getSlackBotToken } from '@/lib/slack';
import { findSlackWarRoomAuthority, projectSlackWarRoomToLegacyIncident } from '../../slack-compatibility';
import { slackApiCall } from './client';

export async function postSlackWarRoomUpdate(
  incidentId: string,
  message: string
): Promise<{ success: boolean; error?: string; sideEffectAmbiguous?: boolean; transportFailure?: boolean; httpStatus?: number }> {
  try {
    const [incident, room] = await Promise.all([
      prisma.incident.findUnique({ where: { id: incidentId }, select: { serviceId: true } }),
      findSlackWarRoomAuthority(incidentId),
    ]);
    if (!room?.providerChannelId) return { success: false, error: 'No war-room channel for this incident' };
    if (room.state === 'ARCHIVED' || room.state === 'CLOSED') return { success: false, error: 'War-room channel is archived' };
    if (!incident) return { success: false, error: 'Incident not found' };
    const botToken = await getSlackBotToken(incident.serviceId);
    if (!botToken) return { success: false, error: 'No Slack bot token' };
    const result = await slackApiCall('chat.postMessage', botToken, {
      channel: room.providerChannelId,
      text: message,
      unfurl_links: false,
    });
    if (!result.ok) return { success: false, error: result.error, sideEffectAmbiguous: result.sideEffectAmbiguous, transportFailure: result.transportFailure, httpStatus: result.httpStatus };
    return { success: true };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[ChatOps] War-room update failed', { incidentId, error: err });
    return { success: false, error: err };
  }
}

/**
 * Provider-I/O only: archives the Slack channel externally. Does NOT mutate
 * IncidentWarRoom state — the neutral engine owns ARCHIVED/CLOSED transitions.
 * Returns ProviderResult-style shape for engine consumption.
 */
export async function archiveExternalSlackRoom(
  warRoomId: string
): Promise<{ ok: boolean; code?: 'NOT_FOUND' | 'TRANSIENT' | 'AMBIGUOUS_SIDE_EFFECT' | 'RATE_LIMITED'; message?: string }> {
  try {
    const room = await prisma.incidentWarRoom.findUnique({
      where: { id: warRoomId },
      select: {
        id: true,
        incidentId: true,
        providerChannelId: true,
        providerChannelName: true,
        state: true,
        generation: true,
        plannedExternalName: true,
        externalCleanupPending: true,
      },
    });
    if (!room) return { ok: false, code: 'NOT_FOUND', message: 'No war-room channel' };
    // Terminal debt lane may call archive with providerChannelId == null when the
    // external create was unverified. Try to resolve the orphan by marker/planned
    // name before deciding NOT_FOUND so we don't leave the provider channel open.
    let channelId = room.providerChannelId;
    if (!channelId) {
      // If already locally terminal and debt pending, marker scan is best-effort;
      // do not block local close on provider lookup — return NOT_FOUND so the
      // engine can settle CLOSED and let the async debt lane retry when
      // credentials recover.
      if (room.state === 'ARCHIVED' || room.state === 'CLOSED') {
        // Debt lane handles orphan reconciliation asynchronously; this immediate
        // archive call must not fail the local close.
        if ((room as { externalCleanupPending?: boolean }).externalCleanupPending) return { ok: false, code: 'NOT_FOUND', message: 'No war-room channel (debt pending)' };
        return { ok: false, code: 'NOT_FOUND', message: 'No war-room channel' };
      }
      // CLOSING-but-unresolved with no local channel id yet — attempt marker
      // resolution so we can archive the orphan immediately if credentials allow.
      try {
        const incidentForLookup = await prisma.incident.findUnique({ where: { id: room.incidentId }, select: { serviceId: true } });
        const tokenForLookup = incidentForLookup ? await getSlackBotToken(incidentForLookup.serviceId).catch(() => null) : null;
        if (tokenForLookup) {
          const { findSlackChannelByMarker, slackWarRoomMarker, findExistingSlackChannel } = await import('./client');
          const marker = slackWarRoomMarker(room.incidentId, (room as { generation: number }).generation);
          let found: { id: string; name: string } | null = null;
          try { found = await findSlackChannelByMarker(tokenForLookup, marker); } catch {}
          if (!found && (room as { plannedExternalName?: string | null }).plannedExternalName) {
            try { found = await findExistingSlackChannel(tokenForLookup, (room as { plannedExternalName: string }).plannedExternalName!); } catch {}
          }
          if (found) channelId = found.id;
          else return { ok: false, code: 'NOT_FOUND', message: 'No war-room channel (marker not found)' };
        } else {
          // Credentials unavailable now — treat as NOT_FOUND for local close;
          // the debt lane will retry when they recover.
          if ((room as { externalCleanupPending?: boolean }).externalCleanupPending) return { ok: false, code: 'NOT_FOUND', message: 'No war-room channel (debt pending, token unavailable)' };
          return { ok: false, code: 'TRANSIENT', message: 'No Slack bot token' };
        }
      } catch {
        return { ok: false, code: 'NOT_FOUND', message: 'No war-room channel' };
      }
    }
    if (room.state === 'ARCHIVED' || room.state === 'CLOSED') return { ok: true };
    const incident = await prisma.incident.findUnique({ where: { id: room.incidentId }, select: { serviceId: true } });
    if (!incident) return { ok: false, code: 'NOT_FOUND', message: 'Incident not found' };
    const botToken = await getSlackBotToken(incident.serviceId);
    if (!botToken) return { ok: false, code: 'TRANSIENT', message: 'No Slack bot token' };

    // Terminal incident state is rendered by the war-room projection's
    // canonical card (RESOLVED/disableActions). Do not emit a standalone
    // chat.postMessage here — the close path would duplicate it on retry.
    await slackApiCall('conversations.setTopic', botToken, {
      channel: channelId,
      topic: '✅ Incident Resolved — This channel has been archived.',
    }).catch(() => {});

    await slackApiCall('conversations.join', botToken, { channel: channelId }).catch(() => {});

    const archiveResult = await slackApiCall('conversations.archive', botToken, {
      channel: channelId,
    });
    const isIdempotentSuccess =
      archiveResult.ok || archiveResult.error === 'already_archived' || archiveResult.error === 'channel_not_found';
    if (!isIdempotentSuccess) {
      const lower = (archiveResult.error ?? '').toLowerCase();
      const isRateLimited = lower.includes('rate_limited') || lower.includes('ratelimited');
      if (isRateLimited) return { ok: false, code: 'RATE_LIMITED', message: archiveResult.error ?? 'Rate limited' };
      if (archiveResult.sideEffectAmbiguous || archiveResult.transportFailure) {
        return { ok: false, code: 'AMBIGUOUS_SIDE_EFFECT', message: archiveResult.error ?? 'Archive ambiguous' };
      }
      logger.warn('[ChatOps] Failed to archive channel', { error: archiveResult.error });
      return { ok: false, code: 'TRANSIENT', message: archiveResult.error || 'Failed to archive Slack channel' };
    }
    if (archiveResult.error === 'already_archived' || archiveResult.error === 'channel_not_found') {
      logger.info('[ChatOps] Channel already archived or not found in Slack; treating as archived', {
        warRoomId,
        channelId,
        slackError: archiveResult.error,
      });
      return { ok: true };
    }

    logger.info('[ChatOps] War-room external archive succeeded', { warRoomId, channelId });
    return { ok: true };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[ChatOps] War-room external archive failed', { warRoomId, error: err });
    return { ok: false, code: 'TRANSIENT', message: err };
  }
}

export async function archiveSlackWarRoomChannel(
  incidentId: string,
  options: { force?: boolean } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const [incident, room] = await Promise.all([
      prisma.incident.findUnique({ where: { id: incidentId }, select: { serviceId: true } }),
      findSlackWarRoomAuthority(incidentId),
    ]);
    if (!incident || !room?.providerChannelId) return { success: false, error: 'No war-room channel' };
    if (room.state === 'ARCHIVED' || room.state === 'CLOSED') return { success: true };
    if (!options.force) {
      const config = await prisma.chatOpsConfig.findUnique({ where: { id: 'default' } });
      if (!config?.archiveOnResolve) return { success: false, error: 'Archive on resolve is disabled' };
    }
    // Delegate external I/O to provider-only function; then let engine own state.
    const ext = await archiveExternalSlackRoom(room.id);
    if (!ext.ok) {
      const lower = (ext.message ?? '').toLowerCase();
      if (lower.includes('channel_not_found') || lower.includes('already_archived') || ext.code === 'NOT_FOUND') {
        // Idempotent success — still commit ARCHIVED via engine path
      } else {
        return { success: false, error: ext.message ?? 'Failed to archive Slack channel' };
      }
    }

    const archivedAt = new Date();
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, state: { in: ['READY', 'CLOSING'] } },
      data: { state: 'ARCHIVED', closedAt: archivedAt, archivedAt },
    });
    await projectSlackWarRoomToLegacyIncident(room.id).catch(err =>
      logger.warn('[ChatOps] Failed to project archive time', { error: err })
    );

    await prisma.incidentEvent
      .create({
        data: { incidentId, type: 'STATUS_CHANGE', message: `War-room channel #${room.providerChannelName} archived` },
      })
      .catch(() => {});

    logger.info('[ChatOps] War-room archived', { incidentId, channelId: room.providerChannelId });
    return { success: true };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[ChatOps] War-room archive failed', { incidentId, error: err });
    return { success: false, error: err };
  }
}

export async function updateSlackWarRoomTopic(
  incidentId: string,
  newStatus?: string
): Promise<{ success: boolean; error?: string; sideEffectAmbiguous?: boolean; transportFailure?: boolean; httpStatus?: number }> {
  try {
    const [incident, room] = await Promise.all([
      prisma.incident.findUnique({
        where: { id: incidentId },
        select: {
          title: true,
          urgency: true,
          status: true,
          serviceId: true,
          assignee: { select: { name: true } },
          team: { select: { name: true } },
        },
      }),
      findSlackWarRoomAuthority(incidentId, { activeOnly: true }),
    ]);
    if (!incident || !room?.providerChannelId) return { success: true };
    const botToken = await getSlackBotToken(incident.serviceId);
    if (!botToken) return { success: true };
    const appUrl = getBaseUrl();
    const dashboardUrl = `${appUrl}/incidents/${incidentId}`;
    const displayStatus = newStatus || incident.status;
    const statusIcon = displayStatus === 'ACKNOWLEDGED' ? '👀' : displayStatus === 'RESOLVED' ? '✅' : '🚨';
    const assigneeText = incident.assignee
      ? ` | 👤 ${incident.assignee.name}`
      : incident.team
        ? ` | 👥 ${incident.team.name}`
        : '';
    const topic = `${statusIcon} ${incident.title} | ${displayStatus} | ${incident.urgency}${assigneeText} | ${dashboardUrl}`;
    const result = await slackApiCall('conversations.setTopic', botToken, {
      channel: room.providerChannelId,
      topic: topic.slice(0, 250),
    });
    if (!result.ok) return { success: false, error: result.error || 'Slack topic update failed', sideEffectAmbiguous: result.sideEffectAmbiguous, transportFailure: result.transportFailure, httpStatus: result.httpStatus };
    return { success: true };
  } catch (err) {
    logger.warn('[ChatOps] Failed to update war-room topic', { incidentId, error: err });
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function inviteUserToSlackWarRoom(
  incidentId: string,
  userId: string,
  source: 'MANUAL' | 'TEAM' = 'MANUAL'
): Promise<{ success: boolean; error?: string }> {
  try {
    const room = await findSlackWarRoomAuthority(incidentId);
    if (!room?.providerChannelId) return { success: false, error: 'No active war-room channel' };
    if (room.state === 'ARCHIVED' || room.state === 'CLOSED') return { success: false, error: 'War-room channel is archived' };
    const { requestWarRoomParticipant } = await import('../../participant-desired-state');
    const result = await requestWarRoomParticipant(room.id, userId, source);
    return result.accepted
      ? { success: true }
      : {
          success: false,
          error: result.code === 'IDENTITY_NOT_LINKED' ? 'User has no verified Slack identity link' : 'War-room is not ready',
        };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[ChatOps] Invite user to war-room failed', { incidentId, userId, error: err });
    return { success: false, error: err };
  }
}

export async function inviteTeamToSlackWarRoom(
  incidentId: string,
  teamId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const teamMembers = await prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } });
    for (const member of teamMembers) {
      await inviteUserToSlackWarRoom(incidentId, member.userId, 'TEAM').catch(() => {});
    }
    return { success: true };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[ChatOps] Invite team to war-room failed', { incidentId, teamId, error: err });
    return { success: false, error: err };
  }
}
