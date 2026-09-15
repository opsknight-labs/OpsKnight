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
    const botToken = await getSlackBotToken(incident.serviceId);
    if (!botToken) return { success: false, error: 'No Slack bot token' };

    await slackApiCall('conversations.setTopic', botToken, {
      channel: room.providerChannelId,
      topic: '✅ Incident Resolved — This channel has been archived.',
    }).catch(() => {});

    await slackApiCall('chat.postMessage', botToken, {
      channel: room.providerChannelId,
      text: '✅ *This incident has been resolved.* Archiving war-room channel.',
    }).catch(() => {});

    await slackApiCall('conversations.join', botToken, { channel: room.providerChannelId }).catch(() => {});

    const archiveResult = await slackApiCall('conversations.archive', botToken, {
      channel: room.providerChannelId,
    });
    const isIdempotentSuccess =
      archiveResult.ok || archiveResult.error === 'already_archived' || archiveResult.error === 'channel_not_found';
    if (!isIdempotentSuccess) {
      logger.warn('[ChatOps] Failed to archive channel', { error: archiveResult.error });
      return { success: false, error: archiveResult.error || 'Failed to archive Slack channel' };
    }
    if (archiveResult.error === 'already_archived' || archiveResult.error === 'channel_not_found') {
      logger.info('[ChatOps] Channel already archived or not found in Slack; treating as archived', {
        incidentId,
        channelId: room.providerChannelId,
        slackError: archiveResult.error,
      });
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
