/**
 * ChatOps War-Room — Slack compatibility surface (thin).
 *
 * All transport now lives in `war-room/providers/slack/*`. This module is kept
 * for the API route and older callers and delegates immediately to the
 * provider-owned boundaries so the engine/queue never depend on this path.
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { findSlackWarRoomAuthority } from '@/lib/war-room/slack-compatibility';

type WarRoomResult = {
  success: boolean;
  channelId?: string;
  channelName?: string;
  warRoomUrl?: string | null;
  warRoomId?: string;
  state?: string;
  error?: string;
};

export type { WarRoomResult };

export { slackApiCall } from '@/lib/war-room/providers/slack/client';
export { generateBridgeUrl } from '@/lib/war-room/bridge';

/**
 * Create a dedicated Slack war-room channel for a critical incident.
 * Durable request boundary only — never performs Slack I/O.
 */
export async function createIncidentWarRoom(
  incidentId: string,
  options: { force?: boolean } = {}
): Promise<WarRoomResult> {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: { include: { slackIntegration: { select: { workspaceId: true } } } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    if (!incident) return { success: false, error: 'Incident not found' };

    const currentRoom = await findSlackWarRoomAuthority(incidentId, { activeOnly: true });
    if (currentRoom?.state === 'READY' && currentRoom.providerChannelId) {
      return {
        success: true,
        channelId: currentRoom.providerChannelId,
        channelName: currentRoom.providerChannelName || undefined,
        warRoomUrl: currentRoom.providerChannelUrl,
        warRoomId: currentRoom.id,
        state: currentRoom.state,
      };
    }

    const allowNewGeneration = ['OPEN', 'ACKNOWLEDGED'].includes(incident.status);
    const { requestSlackWarRoom } = await import('@/lib/war-room/providers/slack/provision');
    const result = await requestSlackWarRoom(incidentId, {
      manual: Boolean(options.force),
      allowNewGeneration,
    });

    if (!result.accepted) {
      const code = result.code;
      const message =
        code === 'INCIDENT_NOT_FOUND'
          ? 'Incident not found'
          : code === 'INCIDENT_NOT_ACTIVE'
            ? 'Incident is not active'
            : code === 'CHATOPS_DISABLED'
              ? 'ChatOps is not enabled'
              : code === 'WAR_ROOMS_DISABLED'
                ? 'ChatOps is not enabled'
                : code === 'DESTINATION_UNAVAILABLE'
                  ? 'No Slack workspace installation configured for this service or organization'
                  : code === 'SERVICE_DISABLED'
                    ? 'War-room auto-creation disabled for this service'
                    : code === 'AUTO_CREATE_DISABLED'
                      ? 'War-room auto-creation disabled for this service'
                      : code === 'THRESHOLD_NOT_MET'
                        ? 'Incident does not meet urgency/priority threshold'
                        : code === 'PRIVATE_DOWNGRADE_DENIED'
                          ? 'War-room provisioning is not permitted for this visibility'
                          : code;
      return { success: false, error: message };
    }

    const fresh = await findSlackWarRoomAuthority(incidentId, { activeOnly: true });
    if (fresh?.state === 'READY' && fresh.providerChannelId) {
      return {
        success: true,
        channelId: fresh.providerChannelId,
        channelName: fresh.providerChannelName || undefined,
        warRoomUrl: fresh.providerChannelUrl,
        warRoomId: fresh.id,
        state: fresh.state,
      };
    }
    const provisioned = await prisma.incidentWarRoom.findUnique({
      where: { id: result.warRoomId },
      select: {
        id: true,
        state: true,
        providerChannelId: true,
        providerChannelName: true,
        providerChannelUrl: true,
      },
    });
    if (provisioned?.state === 'READY' && provisioned.providerChannelId) {
      return {
        success: true,
        channelId: provisioned.providerChannelId,
        channelName: provisioned.providerChannelName || undefined,
        warRoomUrl: provisioned.providerChannelUrl,
        warRoomId: provisioned.id,
        state: provisioned.state,
      };
    }
    return {
      success: true,
      channelId: provisioned?.providerChannelId || undefined,
      channelName: provisioned?.providerChannelName || undefined,
      warRoomUrl: provisioned?.providerChannelUrl ?? null,
      warRoomId: provisioned?.id ?? result.warRoomId,
      state: provisioned?.state ?? result.state,
    };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[ChatOps] War-room creation failed', { incidentId, error: err });
    return { success: false, error: err };
  }
}

// Thin delegations — every side effect lives in war-room/providers/slack.

export async function postWarRoomUpdate(
  incidentId: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const { postSlackWarRoomUpdate } = await import('@/lib/war-room/providers/slack/lifecycle');
  return postSlackWarRoomUpdate(incidentId, message);
}

export async function archiveWarRoomChannel(
  incidentId: string,
  options: { force?: boolean } = {}
): Promise<{ success: boolean; error?: string }> {
  const { archiveSlackWarRoomChannel } = await import('@/lib/war-room/providers/slack/lifecycle');
  return archiveSlackWarRoomChannel(incidentId, options);
}

export async function updateWarRoomTopic(
  incidentId: string,
  newStatus?: string
): Promise<{ success: boolean; error?: string }> {
  const { updateSlackWarRoomTopic } = await import('@/lib/war-room/providers/slack/lifecycle');
  return updateSlackWarRoomTopic(incidentId, newStatus);
}

export async function inviteUserToWarRoom(
  incidentId: string,
  userId: string,
  source: 'MANUAL' | 'TEAM' = 'MANUAL'
): Promise<{ success: boolean; error?: string }> {
  const { inviteUserToSlackWarRoom } = await import('@/lib/war-room/providers/slack/lifecycle');
  return inviteUserToSlackWarRoom(incidentId, userId, source);
}

export async function inviteTeamToWarRoom(
  incidentId: string,
  teamId: string
): Promise<{ success: boolean; error?: string }> {
  const { inviteTeamToSlackWarRoom } = await import('@/lib/war-room/providers/slack/lifecycle');
  return inviteTeamToSlackWarRoom(incidentId, teamId);
}

export async function postWarRoomWelcomeCard(
  channelId: string,
  incidentTitle: string,
  botToken: string
): Promise<void> {
  const { slackApiCall } = await import('@/lib/war-room/providers/slack/client');
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '👋 Welcome to your Incident War Room!', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `This channel was automatically provisioned to coordinate resolution for *${incidentTitle}*.` } },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*⚡ War Room Power Features:*',
          '• 🔘 *1-Click Action Buttons*: Use *Acknowledge*, *Assign to Me*, or *Resolve* on the card above.',
          '• 📌 *Emoji Reaction Sync*: React to ANY message with 📌 (`:pushpin:`) or 📝 (`:memo:`) to auto-save to the incident timeline!',
          '• 📄 *Auto Postmortem*: Type `/incident postmortem` to generate a pre-filled Postmortem draft.',
        ].join('\n'),
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*💬 Quick Slash Commands:*',
          '`/incident ack` — Acknowledge incident',
          '`/incident resolve [summary]` — Resolve incident with notes',
          '`/incident note <message>` — Save a note to the timeline',
          '`/incident who` — View current on-call responders',
          '`/incident postmortem` — Create postmortem draft',
        ].join('\n'),
      },
    },
  ];
  await slackApiCall('chat.postMessage', botToken, {
    channel: channelId,
    blocks,
    text: '👋 Welcome to your Incident War Room! Use 1-click buttons, 📌 emoji pins, or /incident slash commands.',
  }).catch(err => logger.warn('[ChatOps] Failed to post welcome card', { error: err }));
}

export async function ensurePostmortemDraft(incidentId: string): Promise<string | null> {
  try {
    const { getBaseUrl } = await import('@/lib/env-validation');
    const existing = await prisma.postmortem.findUnique({ where: { incidentId }, select: { id: true } });
    const appUrl = getBaseUrl();
    if (existing) return `${appUrl}/postmortems/${incidentId}`;
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { service: { select: { name: true } }, assignee: { select: { id: true, name: true } } },
    });
    if (!incident) return null;
    const notes = await prisma.incidentNote.findMany({
      where: { incidentId },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const events = await prisma.incidentEvent.findMany({ where: { incidentId }, orderBy: { createdAt: 'asc' } });
    const timelineEntries = [
      ...events.map(e => ({
        id: `event-${e.id}`,
        timestamp: e.createdAt.toISOString(),
        type: (e.type === 'ACKNOWLEDGED' || e.type === 'ESCALATED'
          ? 'ESCALATION'
          : e.type === 'MANUAL_RESOLVED' || e.type === 'AUTO_RESOLVED'
            ? 'RESOLUTION'
            : 'DETECTION') as 'DETECTION' | 'ESCALATION' | 'MITIGATION' | 'RESOLUTION',
        title: e.message.slice(0, 60),
        description: e.message,
        actor: 'System',
      })),
      ...notes.map(n => ({
        id: `note-${n.id}`,
        timestamp: n.createdAt.toISOString(),
        type: 'MITIGATION' as const,
        title: `Note by ${n.user?.name ?? 'Deleted user'}`,
        description: n.content,
        actor: n.user?.name ?? 'Deleted user',
      })),
    ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const actionItemsFromNotes = notes
      .filter(n => /todo:|action item:|fix:|followup:/i.test(n.content))
      .map(n => ({
        title: n.content.replace(/^(todo:|action item:|fix:|followup:)\s*/i, '').trim(),
        status: 'OPEN',
        priority: 'MEDIUM',
      }));
    const authorId =
      incident.assigneeId ||
      (await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } }))?.id ||
      (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!authorId) return null;
    await prisma.postmortem.create({
      data: {
        incidentId,
        title: `Postmortem: ${incident.title}`,
        summary: 'Automated postmortem draft generated upon incident resolution.',
        impact: { service: incident.service.name, urgency: incident.urgency },
        rootCause: 'TBD — Auto-generated on Incident Resolution',
        resolution: 'Incident marked as RESOLVED.',
        lessons: 'Timeline and notes captured from incident lifecycle.',
        timeline: timelineEntries as never,
        actionItems: actionItemsFromNotes as never,
        createdById: authorId,
        status: 'DRAFT',
      },
    });
    return `${appUrl}/postmortems/${incidentId}`;
  } catch (err) {
    logger.warn('[ChatOps] Failed to ensure postmortem draft', { incidentId, error: err });
    return null;
  }
}
