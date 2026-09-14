/**
 * ChatOps War-Room Engine (Slack compatibility surface)
 * Request path is delegated to the provider-neutral Slack provision boundary.
 * Side-effect-heavy channel creation is owned by the durable worker
 * `provisionSlackWarRoom`. This module remains the compatibility adapter for
 * existing callers and the API route until the full migration completes.
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSlackBotToken } from '@/lib/slack';
import { getBaseUrl } from '@/lib/env-validation';
import { findSlackWarRoomAuthority, projectSlackWarRoomToLegacyIncident } from '@/lib/war-room/slack-compatibility';

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

/**
 * Slugify a service name for Slack channel naming (lowercase, hyphens, max length)
 */
function slugify(name: string, maxLen: number = 40): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

/**
 * Generate a video bridge URL based on provider configuration
 */
export function generateBridgeUrl(
  incidentId: string,
  provider: string,
  customTemplate?: string | null
): string | null {
  if (!provider || provider === 'NONE') {
    return null;
  }

  const shortId = incidentId.slice(-8);

  // Format custom URL template if provided
  let formattedUrl: string | null = null;
  if (customTemplate && customTemplate.trim()) {
    let urlStr = customTemplate.trim();
    if (!/^https?:\/\//i.test(urlStr)) {
      urlStr = `https://${urlStr}`;
    }

    if (urlStr.includes('{incidentId}')) {
      formattedUrl = urlStr.replace(/\{incidentId\}/g, incidentId);
    } else {
      formattedUrl = urlStr;
    }
  }

  switch (provider) {
    case 'JITSI':
      return formattedUrl || `https://meet.jit.si/opsknight-inc-${shortId}`;

    case 'ZOOM':
      // Zoom requires a valid static meeting URL (e.g. https://us04web.zoom.us/j/1234567890)
      // or custom template. Return formattedUrl if provided, otherwise null
      if (formattedUrl) {
        return formattedUrl;
      }
      return null;

    case 'GOOGLE_MEET':
      if (formattedUrl) {
        return formattedUrl;
      }
      return `https://meet.google.com/lookup/opsknight-inc-${shortId}`;

    default:
      if (formattedUrl) {
        return formattedUrl;
      }
      return null;
  }
}

import { slackApiCall } from '@/lib/war-room/providers/slack/client';
// Re-export provider-scoped Slack transport for tests and other consumers that
// still import from the compatibility surface. The canonical implementation
// lives in the provider client so the engine/queue boundaries stay neutral.
export { slackApiCall };

/**
 * Create a dedicated Slack war-room channel for a critical incident.
 * Durable request boundary only — it never performs Slack I/O. Slack API
 * channel creation (conversations.create, reconciliation, bridging) is owned
 * by the queue worker `provisionSlackWarRoom`.
 *
 * `force` skips the auto-creation gates — the urgency/priority threshold and
 * the per-service autoCreateWarRoom toggle. Both exist to decide when a
 * war-room appears *by itself*; neither should refuse an operator who pressed
 * "Create War-Room" on the incident page. The global `enabled` flag and the
 * bot-token requirement still apply.
 */
export async function createIncidentWarRoom(
  incidentId: string,
  options: { force?: boolean } = {}
): Promise<WarRoomResult> {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: {
          include: { slackIntegration: { select: { workspaceId: true } } },
        },
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    if (!incident) {
      return { success: false, error: 'Incident not found' };
    }

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
    // If the room raced to READY between request and this read, return the channel.
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
    // Also check the exact warRoomId for PROVISIONING/AMBIGUOUS after enqueue.
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

/**
 * Post an update message to an existing war-room channel
 */
export async function postWarRoomUpdate(
  incidentId: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const [incident, room] = await Promise.all([
      prisma.incident.findUnique({
        where: { id: incidentId },
        select: { serviceId: true },
      }),
      findSlackWarRoomAuthority(incidentId),
    ]);

    if (!room?.providerChannelId) {
      return { success: false, error: 'No war-room channel for this incident' };
    }

    if (room.state === 'ARCHIVED' || room.state === 'CLOSED') {
      return { success: false, error: 'War-room channel is archived' };
    }

    if (!incident) {
      return { success: false, error: 'Incident not found' };
    }

    const botToken = await getSlackBotToken(incident.serviceId);
    if (!botToken) {
      return { success: false, error: 'No Slack bot token' };
    }

    const result = await slackApiCall('chat.postMessage', botToken, {
      channel: room.providerChannelId,
      text: message,
      unfurl_links: false,
    });

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[ChatOps] War-room update failed', { incidentId, error: err });
    return { success: false, error: err };
  }
}

/**
 * Archive a war-room channel when incident is resolved.
 *
 * `force` bypasses the `archiveOnResolve` config gate. That setting governs
 * whether archiving happens *automatically* on resolve; it must not block an
 * operator who explicitly asked to archive from the incident page.
 */
export async function archiveWarRoomChannel(
  incidentId: string,
  options: { force?: boolean } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const [incident, room] = await Promise.all([
      prisma.incident.findUnique({
        where: { id: incidentId },
        select: {
          serviceId: true,
        },
      }),
      findSlackWarRoomAuthority(incidentId),
    ]);

    if (!incident || !room?.providerChannelId) {
      return { success: false, error: 'No war-room channel' };
    }

    // Several paths archive on resolve (server action, bulk resolve, Slack
    // button). Without this, a resolve that hits two of them posts the farewell
    // message twice.
    if (room.state === 'ARCHIVED' || room.state === 'CLOSED') {
      return { success: true };
    }

    if (!options.force) {
      const config = await prisma.chatOpsConfig.findUnique({
        where: { id: 'default' },
      });

      if (!config?.archiveOnResolve) {
        return { success: false, error: 'Archive on resolve is disabled' };
      }
    }

    const botToken = await getSlackBotToken(incident.serviceId);
    if (!botToken) {
      return { success: false, error: 'No Slack bot token' };
    }

    // Update topic to resolved
    await slackApiCall('conversations.setTopic', botToken, {
      channel: room.providerChannelId,
      topic: '✅ Incident Resolved — This channel has been archived.',
    }).catch(() => {});

    // Post final message
    await slackApiCall('chat.postMessage', botToken, {
      channel: room.providerChannelId,
      text: `✅ *This incident has been resolved.* Archiving war-room channel.`,
    }).catch(() => {});

    // Ensure bot is in channel before archiving
    await slackApiCall('conversations.join', botToken, {
      channel: room.providerChannelId,
    }).catch(() => {});

    // Archive channel
    const archiveResult = await slackApiCall('conversations.archive', botToken, {
      channel: room.providerChannelId,
    });

    const isIdempotentSuccess =
      archiveResult.ok ||
      archiveResult.error === 'already_archived' ||
      archiveResult.error === 'channel_not_found';

    if (!isIdempotentSuccess) {
      logger.warn('[ChatOps] Failed to archive channel', { error: archiveResult.error });
      return { success: false, error: archiveResult.error || 'Failed to archive Slack channel' };
    }

    if (archiveResult.error === 'already_archived' || archiveResult.error === 'channel_not_found') {
      logger.info(
        '[ChatOps] Channel already archived or not found in Slack; treating as archived',
        {
          incidentId,
          channelId: room.providerChannelId,
          slackError: archiveResult.error,
        }
      );
    }

    const archivedAt = new Date();
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, state: { in: ['READY', 'CLOSING'] } },
      data: { state: 'ARCHIVED', closedAt: archivedAt, archivedAt },
    });
    await projectSlackWarRoomToLegacyIncident(room.id).catch(err =>
      logger.warn('[ChatOps] Failed to project archive time', { error: err })
    );

    // Log event
    await prisma.incidentEvent.create({
      data: {
        incidentId,
        type: 'STATUS_CHANGE',
        message: `War-room channel #${room.providerChannelName} archived`,
      },
    });

    logger.info('[ChatOps] War-room archived', {
      incidentId,
      channelId: room.providerChannelId,
    });

    return { success: true };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[ChatOps] War-room archive failed', { incidentId, error: err });
    return { success: false, error: err };
  }
}

/**
 * Update the Slack war-room channel topic when incident status or metadata changes
 */
export async function updateWarRoomTopic(
  incidentId: string,
  newStatus?: string
): Promise<{ success: boolean; error?: string }> {
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
    const statusIcon =
      displayStatus === 'ACKNOWLEDGED' ? '👀' : displayStatus === 'RESOLVED' ? '✅' : '🚨';
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
    if (!result.ok) return { success: false, error: result.error || 'Slack topic update failed' };
    return { success: true };
  } catch (err) {
    logger.warn('[ChatOps] Failed to update war-room topic', { incidentId, error: err });
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Auto-invite a specific user to an incident's war-room channel
 */
export async function inviteUserToWarRoom(
  incidentId: string,
  userId: string,
  source: 'MANUAL' | 'TEAM' = 'MANUAL'
): Promise<{ success: boolean; error?: string }> {
  try {
    const room = await findSlackWarRoomAuthority(incidentId);
    if (!room?.providerChannelId) {
      return { success: false, error: 'No active war-room channel' };
    }

    // Reassigning an incident whose channel was archived must not drag people
    // into a dead channel — Slack rejects it, and it would be noise if it did not
    if (room.state === 'ARCHIVED' || room.state === 'CLOSED') {
      return { success: false, error: 'War-room channel is archived' };
    }

    const { requestWarRoomParticipant } = await import(
      '@/lib/war-room/participant-desired-state'
    );
    const result = await requestWarRoomParticipant(room.id, userId, source);
    return result.accepted
      ? { success: true }
      : {
          success: false,
          error:
            result.code === 'IDENTITY_NOT_LINKED'
              ? 'User has no verified Slack identity link'
              : 'War-room is not ready',
        };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[ChatOps] Invite user to war-room failed', { incidentId, userId, error: err });
    return { success: false, error: err };
  }
}

/**
 * Auto-invite all members of a team to an incident's war-room channel
 */
export async function inviteTeamToWarRoom(
  incidentId: string,
  teamId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true },
    });

    for (const member of teamMembers) {
      await inviteUserToWarRoom(incidentId, member.userId, 'TEAM').catch(() => {});
    }

    return { success: true };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[ChatOps] Invite team to war-room failed', { incidentId, teamId, error: err });
    return { success: false, error: err };
  }
}

/**
 * Post a welcome & feature hints guide card when a war-room channel is provisioned
 */
export async function postWarRoomWelcomeCard(
  channelId: string,
  incidentTitle: string,
  botToken: string
): Promise<void> {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '👋 Welcome to your Incident War Room!',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `This channel was automatically provisioned to coordinate resolution for *${incidentTitle}*.`,
      },
    },
    {
      type: 'divider',
    },
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

/**
 * Auto-generate postmortem draft on incident resolution
 */
export async function ensurePostmortemDraft(incidentId: string): Promise<string | null> {
  try {
    const existing = await prisma.postmortem.findUnique({
      where: { incidentId },
      select: { id: true },
    });

    const appUrl = getBaseUrl();
    if (existing) {
      return `${appUrl}/postmortems/${incidentId}`;
    }

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: { select: { name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });

    if (!incident) return null;

    // Fetch notes and events
    const notes = await prisma.incidentNote.findMany({
      where: { incidentId },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const events = await prisma.incidentEvent.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'asc' },
    });

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

    // Find author (assignee or admin fallback)
    const authorId =
      incident.assigneeId ||
      (await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } }))?.id ||
      (await prisma.user.findFirst({ select: { id: true } }))?.id;

    if (!authorId) return null;

    const postmortem = await prisma.postmortem.create({
      data: {
        incidentId,
        title: `Postmortem: ${incident.title}`,
        summary: `Automated postmortem draft generated upon incident resolution.`,
        impact: { service: incident.service.name, urgency: incident.urgency },
        rootCause: 'TBD — Auto-generated on Incident Resolution',
        resolution: `Incident marked as RESOLVED.`,
        lessons: 'Timeline and notes captured from incident lifecycle.',
        timeline: timelineEntries as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        actionItems: actionItemsFromNotes as any, // eslint-disable-line @typescript-eslint/no-explicit-any
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
