/**
 * ChatOps War-Room Engine
 * Provisions dedicated Slack channels for critical incidents,
 * auto-invites on-call responders, generates video bridges,
 * and posts rich Incident Command Cards.
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSlackBotToken, sendSlackMessageToChannel } from '@/lib/slack';
import { getBaseUrl } from '@/lib/env-validation';
import { retryFetch } from '@/lib/retry';

type WarRoomResult = {
  success: boolean;
  channelId?: string;
  channelName?: string;
  warRoomUrl?: string | null;
  error?: string;
};

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

/**
 * Call a Slack API method with bot token authentication
 */
export async function slackApiCall(
  method: string,
  botToken: string,
  body: Record<string, unknown>
): Promise<{
  ok: boolean;
  error?: string;
  channel?: { id: string; name: string };
  user?: { profile?: { email?: string } };
}> {
  try {
    const response = await retryFetch(
      `https://slack.com/api/${method}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify(body),
      },
      {
        maxAttempts: 2,
        initialDelayMs: 500,
        retryableErrors: error => {
          if (error instanceof Error) {
            // Network blips, plus Slack rate limiting and server errors, which
            // retryFetch surfaces as a thrown `HTTP <status>: <text>` error.
            return (
              error.message.includes('fetch') ||
              error.message.includes('network') ||
              /^HTTP (429|5\d{2}):/.test(error.message)
            );
          }
          return false;
        },
      }
    );

    return await response.json();
  } catch (error) {
    // Callers branch on `result.ok`; throwing here made rate limits surface as
    // an exception on some paths and get silently swallowed on others.
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[ChatOps] Slack API call failed', { method, error: message });
    return { ok: false, error: message };
  }
}

/**
 * Lookup Slack user by email via HTTP GET query parameters
 */
async function findSlackUserByEmail(
  botToken: string,
  email: string
): Promise<{ ok: boolean; error?: string; user?: { id: string } }> {
  const url = `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`;
  try {
    const response = await retryFetch(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${botToken}`,
        },
      },
      {
        maxAttempts: 2,
        initialDelayMs: 500,
      }
    );
    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[ChatOps] Slack user lookup failed', { error: message });
    return { ok: false, error: message };
  }
}

/**
 * Create a dedicated Slack war-room channel for a critical incident.
 * Checks eligibility based on ChatOpsConfig thresholds and service settings.
 *
 * `force` skips the auto-creation gates — the urgency/priority threshold and
 * the per-service autoCreateWarRoom toggle. Both exist to decide when a
 * war-room appears *by itself*; neither should refuse an operator who pressed
 * "Create War-Room" on the incident page. The global `enabled` flag and the
 * bot-token requirement still apply, since without them there is no
 * integration to create anything in.
 */
export async function createIncidentWarRoom(
  incidentId: string,
  options: { force?: boolean } = {}
): Promise<WarRoomResult> {
  try {
    // Load incident with service
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: true,
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    if (!incident) {
      return { success: false, error: 'Incident not found' };
    }

    // Already has a live war-room. An archived one does not count — reopening an
    // incident should be able to provision a fresh channel.
    if (incident.slackChannelId && !incident.warRoomArchivedAt) {
      return {
        success: true,
        channelId: incident.slackChannelId,
        channelName: incident.slackChannelName || undefined,
      };
    }

    // Load global ChatOps config
    const config = await prisma.chatOpsConfig.findUnique({
      where: { id: 'default' },
    });

    if (!config?.enabled) {
      return { success: false, error: 'ChatOps is not enabled' };
    }

    if (!options.force) {
      // Check per-service override
      if (!incident.service.autoCreateWarRoom) {
        return { success: false, error: 'War-room auto-creation disabled for this service' };
      }

      // Check urgency threshold
      const urgencyMatch = config.autoCreateOnUrgency.includes(incident.urgency);
      const priorityMatch = incident.priority
        ? config.autoCreateOnPriority.includes(incident.priority)
        : false;

      if (!urgencyMatch && !priorityMatch) {
        return { success: false, error: 'Incident does not meet urgency/priority threshold' };
      }
    }

    // Get bot token
    const botToken = await getSlackBotToken(incident.serviceId);
    if (!botToken) {
      return { success: false, error: 'No Slack bot token configured' };
    }

    // Generate channel name
    const serviceSlug = slugify(incident.service.name);
    const idSuffix = incidentId.slice(-6);
    const channelName = `${config.channelPrefix}-${idSuffix}-${serviceSlug}`.slice(0, 80);

    // Create channel via Slack API
    let effectiveChannelName = channelName;
    let createResult = await slackApiCall('conversations.create', botToken, {
      name: effectiveChannelName,
      is_private: false,
    });

    if (!createResult.ok && createResult.error === 'name_taken') {
      const suffix = Math.floor(Math.random() * 8999 + 1000).toString();
      effectiveChannelName = `${channelName.slice(0, 74)}-${suffix}`;
      createResult = await slackApiCall('conversations.create', botToken, {
        name: effectiveChannelName,
        is_private: false,
      });
    }

    if (!createResult.ok) {
      logger.error('[ChatOps] Failed to create Slack channel', {
        error: createResult.error,
        channelName: effectiveChannelName,
        incidentId,
      });
      const errorMsg =
        createResult.error === 'missing_scope'
          ? "Slack app is missing the 'channels:manage' scope. Please re-authorize Slack in Settings > Slack to grant channel creation permissions."
          : `Slack API error: ${createResult.error}`;
      return { success: false, error: errorMsg };
    }

    const channelId = createResult.channel?.id;
    if (!channelId) {
      return { success: false, error: 'No channel ID returned from Slack' };
    }

    // Set channel topic
    const appUrl = getBaseUrl();
    const dashboardUrl = `${appUrl}/incidents/${incidentId}`;
    const topic = `🚨 ${incident.title} | ${incident.urgency} | ${dashboardUrl}`;

    await slackApiCall('conversations.setTopic', botToken, {
      channel: channelId,
      topic: topic.slice(0, 250),
    }).catch(err => logger.warn('[ChatOps] Failed to set channel topic', { error: err }));

    // Resolve and invite on-call responders
    try {
      const { resolveEscalationTarget } = await import('@/lib/escalation');

      const service = await prisma.service.findUnique({
        where: { id: incident.serviceId },
        include: {
          policy: {
            include: {
              steps: {
                orderBy: { stepOrder: 'asc' },
                take: 3, // First 3 escalation steps
              },
            },
          },
        },
      });

      const userIdsToInvite = new Set<string>();

      // Collect user IDs from escalation policy steps (Schedules, Teams, Users)
      if (service?.policy?.steps) {
        for (const step of service.policy.steps) {
          const targetId = step.targetUserId || step.targetTeamId || step.targetScheduleId;
          if (targetId) {
            try {
              const resolvedUserIds = await resolveEscalationTarget(
                step.targetType as 'USER' | 'TEAM' | 'SCHEDULE',
                targetId,
                new Date(),
                step.notifyOnlyTeamLead
              );
              resolvedUserIds.forEach(id => userIdsToInvite.add(id));
            } catch (stepErr) {
              logger.warn('[ChatOps] Failed to resolve step target', { targetId, error: stepErr });
            }
          }
        }
      }

      // Add the current assignee (re-query latest from DB in case escalation just assigned it)
      const latestIncidentAssignee = await prisma.incident.findUnique({
        where: { id: incidentId },
        select: { assigneeId: true },
      });
      const activeAssigneeId = latestIncidentAssignee?.assigneeId || incident.assigneeId;
      if (activeAssigneeId) {
        userIdsToInvite.add(activeAssigneeId);
      }

      const emailsToInvite = new Set<string>();

      // Fetch emails for all resolved user IDs
      if (userIdsToInvite.size > 0) {
        const usersToInvite = await prisma.user.findMany({
          where: { id: { in: Array.from(userIdsToInvite) } },
          select: { id: true, name: true, email: true },
        });

        for (const user of usersToInvite) {
          if (user.email) {
            emailsToInvite.add(user.email);
          }
        }
      }

      // Parallel email lookups using GET-based findSlackUserByEmail
      // (slackApiCall sends POST+JSON which causes `invalid_arguments` for users.lookupByEmail)
      const lookupResults = await Promise.allSettled(
        Array.from(emailsToInvite).map(async email => {
          const lookupResult = await findSlackUserByEmail(botToken, email.trim().toLowerCase());
          if (lookupResult.ok && (lookupResult as any).user?.id) {
            return (lookupResult as any).user.id as string; // eslint-disable-line @typescript-eslint/no-explicit-any
          }
          const lookupErr = lookupResult.error || 'User not found in Slack workspace';
          logger.warn('[ChatOps] Could not find Slack user by email', {
            email,
            error: lookupErr,
          });
          // Log to incident timeline for visibility
          await prisma.incidentEvent
            .create({
              data: {
                incidentId,
                message: `War-room: Could not invite user (${email}) — ${lookupErr === 'users_not_found' ? 'email not found in Slack workspace' : lookupErr}`,
              },
            })
            .catch(() => {});
          return null;
        })
      );

      const slackUserIds: string[] = lookupResults
        .filter(
          (r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled' && r.value !== null
        )
        .map(r => r.value);

      if (slackUserIds.length > 0) {
        // Try batch invite first to conserve Slack Tier 3 rate limits
        const batchResult = await slackApiCall('conversations.invite', botToken, {
          channel: channelId,
          users: slackUserIds.join(','),
        });

        if (!batchResult.ok && batchResult.error !== 'already_in_channel') {
          // Fallback to individual invites if batch encountered a mixed error
          for (const slackUserId of slackUserIds) {
            const indResult = await slackApiCall('conversations.invite', botToken, {
              channel: channelId,
              users: slackUserId,
            });
            if (!indResult.ok && indResult.error !== 'already_in_channel') {
              logger.warn('[ChatOps] Failed to invite user to war-room', {
                slackUserId,
                error: indResult.error,
              });
            }
          }
        }
      }
    } catch (err) {
      logger.warn('[ChatOps] Failed to resolve/invite responders', { error: err, incidentId });
    }

    // Generate video bridge URL
    const videoBridge = incident.service.warRoomVideoBridge || config.defaultVideoBridge;
    const customUrl = incident.service.warRoomCustomBridgeUrl || config.customBridgeUrlTemplate;
    const warRoomUrl = generateBridgeUrl(incidentId, videoBridge, customUrl);

    // Post Incident Command Card to the channel
    await sendSlackMessageToChannel(
      channelId,
      {
        id: incident.id,
        title: incident.title,
        status: incident.status,
        urgency: incident.urgency,
        serviceName: incident.service.name,
        assigneeName: incident.assignee?.name,
      },
      'triggered',
      true,
      incident.serviceId,
      warRoomUrl ? `📹 Video Bridge: ${warRoomUrl}` : undefined
    ).catch(err => logger.warn('[ChatOps] Failed to post command card', { error: err }));

    // Post War-Room Welcome & Feature Hints Card
    await postWarRoomWelcomeCard(channelId, incident.title, botToken).catch(err =>
      logger.warn('[ChatOps] Failed to post welcome card', { error: err })
    );

    // Update incident with war-room metadata
    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        slackChannelId: channelId,
        slackChannelName: channelName,
        warRoomUrl,
        warRoomArchivedAt: null,
      },
    });

    // Log timeline event
    await prisma.incidentEvent.create({
      data: {
        incidentId,
        message: `War-room channel #${channelName} created${warRoomUrl ? ` with video bridge` : ''}`,
      },
    });

    logger.info('[ChatOps] War-room created successfully', {
      incidentId,
      channelId,
      channelName,
      warRoomUrl,
    });

    return { success: true, channelId, channelName, warRoomUrl };
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
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { slackChannelId: true, serviceId: true, warRoomArchivedAt: true },
    });

    if (!incident?.slackChannelId) {
      return { success: false, error: 'No war-room channel for this incident' };
    }

    if (incident.warRoomArchivedAt) {
      return { success: false, error: 'War-room channel is archived' };
    }

    const botToken = await getSlackBotToken(incident.serviceId);
    if (!botToken) {
      return { success: false, error: 'No Slack bot token' };
    }

    const result = await slackApiCall('chat.postMessage', botToken, {
      channel: incident.slackChannelId,
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
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        slackChannelId: true,
        slackChannelName: true,
        serviceId: true,
        warRoomArchivedAt: true,
      },
    });

    if (!incident?.slackChannelId) {
      return { success: false, error: 'No war-room channel' };
    }

    // Several paths archive on resolve (server action, bulk resolve, Slack
    // button). Without this, a resolve that hits two of them posts the farewell
    // message twice.
    if (incident.warRoomArchivedAt) {
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
      channel: incident.slackChannelId,
      topic: '✅ Incident Resolved — This channel has been archived.',
    }).catch(() => {});

    // Post final message
    await slackApiCall('chat.postMessage', botToken, {
      channel: incident.slackChannelId,
      text: `✅ *This incident has been resolved.* Archiving war-room channel.`,
    }).catch(() => {});

    // Ensure bot is in channel before archiving
    await slackApiCall('conversations.join', botToken, {
      channel: incident.slackChannelId,
    }).catch(() => {});

    // Archive channel
    const archiveResult = await slackApiCall('conversations.archive', botToken, {
      channel: incident.slackChannelId,
    });

    if (!archiveResult.ok && archiveResult.error !== 'already_archived') {
      logger.warn('[ChatOps] Failed to archive channel', { error: archiveResult.error });
    }

    // Mark the war-room as archived. The channel id is kept so the incident
    // retains its history; this is what stops the UI advertising a live channel
    // and stops later updates being posted where nobody will read them.
    await prisma.incident
      .update({ where: { id: incidentId }, data: { warRoomArchivedAt: new Date() } })
      .catch(err => logger.warn('[ChatOps] Failed to record archive time', { error: err }));

    // Log event
    await prisma.incidentEvent.create({
      data: {
        incidentId,
        message: `War-room channel #${incident.slackChannelName} archived`,
      },
    });

    logger.info('[ChatOps] War-room archived', {
      incidentId,
      channelId: incident.slackChannelId,
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
export async function updateWarRoomTopic(incidentId: string, newStatus?: string): Promise<void> {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        title: true,
        urgency: true,
        status: true,
        slackChannelId: true,
        serviceId: true,
        warRoomArchivedAt: true,
        assignee: { select: { name: true } },
        team: { select: { name: true } },
      },
    });

    if (!incident?.slackChannelId || incident.warRoomArchivedAt) return;

    const botToken = await getSlackBotToken(incident.serviceId);
    if (!botToken) return;

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

    await slackApiCall('conversations.setTopic', botToken, {
      channel: incident.slackChannelId,
      topic: topic.slice(0, 250),
    }).catch(() => {});
  } catch (err) {
    logger.warn('[ChatOps] Failed to update war-room topic', { incidentId, error: err });
  }
}

/**
 * Auto-invite a specific user to an incident's war-room channel
 */
export async function inviteUserToWarRoom(
  incidentId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        slackChannelId: true,
        slackChannelName: true,
        serviceId: true,
        warRoomArchivedAt: true,
      },
    });

    if (!incident?.slackChannelId) {
      return { success: false, error: 'No active war-room channel' };
    }

    // Reassigning an incident whose channel was archived must not drag people
    // into a dead channel — Slack rejects it, and it would be noise if it did not
    if (incident.warRoomArchivedAt) {
      return { success: false, error: 'War-room channel is archived' };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (!user?.email) {
      return { success: false, error: 'User has no email configured' };
    }

    const botToken = await getSlackBotToken(incident.serviceId);
    if (!botToken) {
      return { success: false, error: 'No Slack bot token' };
    }

    const normalizedEmail = user.email.trim().toLowerCase();
    const lookupResult = await findSlackUserByEmail(botToken, normalizedEmail);

    if (!lookupResult.ok || !(lookupResult as any).user?.id) {
      const lookupErr = lookupResult.error || 'User not found in Slack workspace';
      const reason =
        lookupErr === 'user_not_found'
          ? `Email ${normalizedEmail} not found in Slack workspace`
          : lookupErr === 'missing_scope'
            ? `Slack app is missing 'users:read.email' scope`
            : lookupErr;

      await prisma.incidentEvent
        .create({
          data: {
            incidentId,
            message: `Slack War-Room: Could not auto-invite ${user.name} (${reason})`,
          },
        })
        .catch(() => {});

      return { success: false, error: reason };
    }

    const slackUserId = (lookupResult as any).user.id as string; // eslint-disable-line @typescript-eslint/no-explicit-any
    const inviteResult = await slackApiCall('conversations.invite', botToken, {
      channel: incident.slackChannelId,
      users: slackUserId,
    });

    if (!inviteResult.ok && (inviteResult as any).error !== 'already_in_channel') {
      const inviteErr = (inviteResult as any).error || 'Failed to invite user'; // eslint-disable-line @typescript-eslint/no-explicit-any
      await prisma.incidentEvent
        .create({
          data: {
            incidentId,
            message: `Slack War-Room: Could not invite ${user.name} to channel #${incident.slackChannelName} (${inviteErr})`,
          },
        })
        .catch(() => {});

      return { success: false, error: inviteErr };
    }

    return { success: true };
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
      await inviteUserToWarRoom(incidentId, member.userId).catch(() => {});
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
      ...events.map(e => ({ time: e.createdAt, text: e.message, type: 'event' })),
      ...notes.map(n => ({
        time: n.createdAt,
        text: `[${n.user.name}]: ${n.content}`,
        type: 'note',
      })),
    ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

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
