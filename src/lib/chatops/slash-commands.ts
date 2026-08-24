/**
 * ChatOps Slash Command Dispatcher
 * Handles /incident slash commands from Slack war-room channels.
 * Supports: ack, resolve, note, who, help
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSlackBotToken } from '@/lib/slack';
import { retryFetch } from '@/lib/retry';

export interface SlashCommandPayload {
  command: string;
  text: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  team_id: string;
  response_url: string;
}

interface SlackResponse {
  response_type: 'in_channel' | 'ephemeral';
  text?: string;
  blocks?: unknown[];
}

/**
 * Resolve a Slack user ID to an OpsKnight user with robust multi-level fallback:
 * 1. Match by email (case-insensitive)
 * 2. Match by Slack display_name / real_name / user_name against OpsKnight user name
 * 3. Fallback to incident assignee or first admin user so commands never fail
 */
async function resolveOpsKnightUser(
  slackUserId: string,
  botToken: string,
  fallbackAssigneeId?: string | null,
  slackUserName?: string
) {
  try {
    let slackEmail: string | undefined;
    let slackRealName: string | undefined;

    if (botToken) {
      const response = await retryFetch(
        `https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${botToken}`,
          },
        },
        { maxAttempts: 2, initialDelayMs: 300 }
      );

      const data = await response.json();
      if (data.ok && data.user) {
        slackEmail = data.user.profile?.email?.trim();
        slackRealName = (
          data.user.profile?.real_name ||
          data.user.real_name ||
          data.user.name
        )?.trim();
      }
    }

    // 1. Try match by email
    if (slackEmail) {
      const userByEmail = await prisma.user.findFirst({
        where: { email: { equals: slackEmail, mode: 'insensitive' } },
        select: { id: true, name: true, email: true },
      });
      if (userByEmail) return userByEmail;
    }

    // 2. Try match by real_name or user_name
    const nameToMatch = (slackRealName || slackUserName)?.trim();
    if (nameToMatch) {
      const firstName = nameToMatch.split(' ')[0];
      const userByName = await prisma.user.findFirst({
        where: {
          OR: [
            { name: { equals: nameToMatch, mode: 'insensitive' } },
            { name: { contains: firstName, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, email: true },
      });
      if (userByName) return userByName;
    }

    // 3. Fallback to incident assignee
    if (fallbackAssigneeId) {
      const fallbackUser = await prisma.user.findUnique({
        where: { id: fallbackAssigneeId },
        select: { id: true, name: true, email: true },
      });
      if (fallbackUser) return fallbackUser;
    }

    // 4. Fallback to system admin user
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true, name: true, email: true },
    });
    return adminUser;
  } catch (error) {
    logger.warn('[ChatOps] Failed to resolve Slack user', { slackUserId, error });
    return null;
  }
}

/**
 * Main slash command dispatcher
 */
export async function handleSlashCommand(payload: SlashCommandPayload): Promise<SlackResponse> {
  const { text, channel_id, user_id } = payload;

  // Parse subcommand and preserve raw argument formatting (including newlines and tabs)
  const trimmed = text.trim();
  const firstSpaceIndex = trimmed.search(/\s/);
  const subcommand =
    (firstSpaceIndex === -1 ? trimmed : trimmed.slice(0, firstSpaceIndex)).toLowerCase() || 'help';
  const args = firstSpaceIndex === -1 ? '' : trimmed.slice(firstSpaceIndex).trim();

  // Find incident linked to this channel
  const incident = await prisma.incident.findFirst({
    where: {
      slackChannelId: channel_id,
    },
    include: {
      service: { select: { id: true, name: true, escalationPolicyId: true } },
      assignee: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Handle 'help' and 'who' without requiring an incident
  if (subcommand === 'help') {
    return {
      response_type: 'ephemeral',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🛡️ OpsKnight Incident Commands', emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              '`/incident ack` — Acknowledge this incident',
              '`/incident resolve [summary]` — Resolve with optional summary',
              '`/incident note <message>` — Add an incident note',
              '`/incident who` — Show who is on-call',
              '`/incident postmortem` — Create a postmortem draft from timeline & notes',
              '`/incident help` — Show this help message',
            ].join('\n'),
          },
        },
      ],
    };
  }

  if (!incident) {
    return {
      response_type: 'ephemeral',
      text: '⚠️ No incident is linked to this channel. This command only works in OpsKnight war-room channels.',
    };
  }

  // Get bot token for user resolution
  const botToken = await getSlackBotToken(incident.service.id);

  switch (subcommand) {
    case 'ack':
    case 'acknowledge': {
      if (incident.status === 'ACKNOWLEDGED' || incident.status === 'RESOLVED') {
        return {
          response_type: 'ephemeral',
          text: `ℹ️ Incident is already ${incident.status.toLowerCase()}.`,
        };
      }

      await prisma.incident.update({
        where: { id: incident.id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: incident.acknowledgedAt ?? new Date(),
          escalationStatus: 'COMPLETED',
          nextEscalationAt: null,
        },
      });

      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          message: `Acknowledged via Slack ChatOps by @${payload.user_name}`,
        },
      });

      logger.info('[ChatOps] Incident acknowledged via slash command', {
        incidentId: incident.id,
        slackUser: payload.user_name,
      });

      // Dispatch incident notifications
      import('@/lib/user-notifications')
        .then(({ sendIncidentNotifications }) =>
          sendIncidentNotifications(incident.id, 'acknowledged')
        )
        .catch(err =>
          logger.error('[ChatOps] Failed to send ack notifications', {
            error: err,
            incidentId: incident.id,
          })
        );

      // Update channel topic to ACKNOWLEDGED
      try {
        const { updateWarRoomTopic } = await import('@/lib/chatops/war-room');
        updateWarRoomTopic(incident.id, 'ACKNOWLEDGED').catch(err =>
          logger.warn('[ChatOps] Failed to update topic on ack', { error: err })
        );
      } catch (e) {
        logger.warn('[ChatOps] Failed to load war-room module', { error: e });
      }

      return {
        response_type: 'in_channel',
        text: `👀 *Incident Acknowledged* by <@${user_id}>\n_${incident.title}_`,
      };
    }

    case 'resolve': {
      if (incident.status === 'RESOLVED') {
        return {
          response_type: 'ephemeral',
          text: 'ℹ️ Incident is already resolved.',
        };
      }

      const resolution = args || 'Resolved via Slack ChatOps';

      await prisma.incident.update({
        where: { id: incident.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: incident.resolvedAt ?? new Date(),
          escalationStatus: 'COMPLETED',
          nextEscalationAt: null,
        },
      });

      // Create resolution note
      let noteUserId: string | undefined;
      if (botToken) {
        const opsUser = await resolveOpsKnightUser(
          user_id,
          botToken,
          incident.assigneeId,
          payload.user_name
        );
        noteUserId = opsUser?.id;
      }

      if (noteUserId) {
        await prisma.incidentNote.create({
          data: {
            incidentId: incident.id,
            userId: noteUserId,
            content: `[Resolution] ${resolution}`,
          },
        });
      }

      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          message: `Resolved via Slack ChatOps by @${payload.user_name}: ${resolution}`,
        },
      });

      logger.info('[ChatOps] Incident resolved via slash command', {
        incidentId: incident.id,
        slackUser: payload.user_name,
      });

      // Dispatch incident notifications
      import('@/lib/user-notifications')
        .then(({ sendIncidentNotifications }) => sendIncidentNotifications(incident.id, 'resolved'))
        .catch(err =>
          logger.error('[ChatOps] Failed to send resolve notifications', {
            error: err,
            incidentId: incident.id,
          })
        );

      // Archive war-room channel on resolve
      try {
        const { archiveWarRoomChannel } = await import('@/lib/chatops/war-room');
        archiveWarRoomChannel(incident.id).catch(err =>
          logger.warn('[ChatOps] Failed to archive war-room after slash resolve', { error: err })
        );
      } catch (e) {
        logger.warn('[ChatOps] Failed to load war-room module', { error: e });
      }

      return {
        response_type: 'in_channel',
        text: `✅ *Incident Resolved* by <@${user_id}>\n_${resolution}_`,
      };
    }

    case 'note': {
      if (!args) {
        return {
          response_type: 'ephemeral',
          text: '⚠️ Please provide a note message: `/incident note <your message>`',
        };
      }

      let noteUserId: string | undefined;
      if (botToken) {
        const opsUser = await resolveOpsKnightUser(
          user_id,
          botToken,
          incident.assigneeId,
          payload.user_name
        );
        noteUserId = opsUser?.id;
      }

      if (!noteUserId) {
        return {
          response_type: 'ephemeral',
          text: '⚠️ Could not find your OpsKnight account. Please make sure your Slack email matches your OpsKnight email.',
        };
      }

      await prisma.incidentNote.create({
        data: {
          incidentId: incident.id,
          userId: noteUserId,
          content: args,
        },
      });

      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          message: `Note added via Slack ChatOps by @${payload.user_name}`,
        },
      });

      logger.info('[ChatOps] Note added via slash command', {
        incidentId: incident.id,
        slackUser: payload.user_name,
      });

      return {
        response_type: 'in_channel',
        text: `📝 *Note added* by <@${user_id}>:\n> ${args}`,
      };
    }

    case 'who': {
      // Query on-call schedule for the service
      try {
        const policy = incident.service.escalationPolicyId
          ? await prisma.escalationPolicy.findUnique({
              where: { id: incident.service.escalationPolicyId },
              include: {
                steps: {
                  include: {
                    targetUser: { select: { name: true, email: true } },
                    targetSchedule: { select: { id: true, name: true } },
                    targetTeam: {
                      select: {
                        name: true,
                        members: {
                          include: { user: { select: { name: true } } },
                          where: { role: { in: ['OWNER', 'ADMIN'] } },
                          take: 5,
                        },
                      },
                    },
                  },
                  orderBy: { stepOrder: 'asc' },
                },
              },
            })
          : null;

        if (!policy?.steps?.length) {
          return {
            response_type: 'ephemeral',
            text: `ℹ️ No escalation policy configured for *${incident.service.name}*.`,
          };
        }

        const lines = await Promise.all(
          policy.steps.map(async (step, i) => {
            const targets: string[] = [];
            if (step.targetUser) targets.push(`👤 ${step.targetUser.name}`);
            if (step.targetTeam) {
              const members = step.targetTeam.members.map(m => m.user.name).join(', ');
              targets.push(`👥 ${step.targetTeam.name} (${members})`);
            }
            if (step.targetSchedule) {
              // Try to resolve current on-call from schedule
              try {
                const { resolveEscalationTarget } = await import('@/lib/escalation');
                const userIds = await resolveEscalationTarget(
                  'SCHEDULE',
                  step.targetSchedule.id,
                  new Date()
                );
                if (userIds.length > 0) {
                  const users = await prisma.user.findMany({
                    where: { id: { in: userIds } },
                    select: { name: true },
                  });
                  targets.push(
                    `📅 ${step.targetSchedule.name} (On-call: ${users.map(u => u.name).join(', ')})`
                  );
                } else {
                  targets.push(`📅 ${step.targetSchedule.name} (No one on-call)`);
                }
              } catch {
                targets.push(`📅 ${step.targetSchedule.name}`);
              }
            }
            return `*Step ${i + 1}* (${step.delayMinutes}min delay): ${targets.join(', ') || 'Schedule-based'}`;
          })
        );

        return {
          response_type: 'ephemeral',
          text: `📋 *On-Call for ${incident.service.name}:*\n${lines.join('\n')}`,
        };
      } catch (error) {
        logger.error('[ChatOps] Failed to query on-call', { error });
        return {
          response_type: 'ephemeral',
          text: '⚠️ Failed to query on-call information.',
        };
      }
    }

    case 'postmortem': {
      try {
        const appUrl = (await import('@/lib/env-validation')).getBaseUrl();
        const existingPostmortem = await prisma.postmortem.findUnique({
          where: { incidentId: incident.id },
          select: { id: true, title: true, status: true },
        });

        if (existingPostmortem) {
          const postmortemUrl = `${appUrl}/postmortems/${incident.id}`;
          return {
            response_type: 'in_channel',
            text: `📄 *Postmortem Draft Exists*\nTitle: *${existingPostmortem.title}* (${existingPostmortem.status})\n🔗 *Edit & Publish:* ${postmortemUrl}`,
          };
        }

        // Resolve author
        let authorUserId: string | undefined;
        if (botToken) {
          const opsUser = await resolveOpsKnightUser(
            user_id,
            botToken,
            incident.assigneeId,
            payload.user_name
          );
          authorUserId = opsUser?.id;
        }

        const defaultAuthor = authorUserId
          ? authorUserId
          : (await prisma.user.findFirst({ select: { id: true } }))?.id;

        if (!defaultAuthor) {
          return {
            response_type: 'ephemeral',
            text: '⚠️ Could not resolve author for postmortem.',
          };
        }

        // Fetch incident notes and events for timeline
        const notes = await prisma.incidentNote.findMany({
          where: { incidentId: incident.id },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        });

        const events = await prisma.incidentEvent.findMany({
          where: { incidentId: incident.id },
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
            title: `Note by ${n.user.name}`,
            description: n.content,
            actor: n.user.name,
          })),
        ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        const actionItemsFromNotes = notes
          .filter(n => /todo:|action item:|fix:|followup:/i.test(n.content))
          .map(n => ({
            title: n.content.replace(/^(todo:|action item:|fix:|followup:)\s*/i, '').trim(),
            status: 'OPEN',
            priority: 'MEDIUM',
          }));

        const newPostmortem = await prisma.postmortem.create({
          data: {
            incidentId: incident.id,
            title: `Postmortem: ${incident.title}`,
            summary: `Automated postmortem draft generated from Slack war-room #${payload.channel_name}`,
            impact: { service: incident.service.name, urgency: incident.urgency },
            rootCause: 'TBD — Generated from Slack War Room',
            resolution: `Resolved via ChatOps by @${payload.user_name}`,
            lessons: 'Timeline and notes captured from Slack war-room channel.',
            timeline: timelineEntries as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            actionItems: actionItemsFromNotes as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            createdById: defaultAuthor,
            status: 'DRAFT',
          },
        });

        await prisma.incidentEvent.create({
          data: {
            incidentId: incident.id,
            message: `Postmortem draft generated via Slack ChatOps by @${payload.user_name}`,
          },
        });

        const editUrl = `${appUrl}/postmortems/${incident.id}`;

        return {
          response_type: 'in_channel',
          text: `📄 *Postmortem Draft Created!*\n*Title:* ${newPostmortem.title}\n*Timeline Events Captured:* ${timelineEntries.length}\n🔗 *Edit & Publish:* ${editUrl}`,
        };
      } catch (pmErr) {
        logger.error('[ChatOps] Failed to create postmortem via slash command', { error: pmErr });
        return {
          response_type: 'ephemeral',
          text: '⚠️ Failed to generate postmortem draft.',
        };
      }
    }

    default:
      return {
        response_type: 'ephemeral',
        text: `❓ Unknown command: \`${subcommand}\`. Try \`/incident help\` for available commands.`,
      };
  }
}
