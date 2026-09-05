/**
 * ChatOps Slash Command Dispatcher
 * Handles /incident slash commands from Slack war-room channels.
 * Supports: ack, resolve, note, who, help
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSlackBotToken } from '@/lib/slack';
import { retryFetch } from '@/lib/retry';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsLifecycleCommand,
  authorizeChatOpsIncident,
} from '@/lib/incidents/chatops-lifecycle';
import { executeIdempotentOperation } from '@/lib/idempotency';
import { runSerializableTransaction } from '@/lib/db-utils';

export interface SlashCommandPayload {
  command: string;
  text: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  team_id: string;
  response_url: string;
  __opsknightIntentId?: string;
}

interface SlackResponse {
  response_type: 'in_channel' | 'ephemeral';
  text?: string;
  blocks?: unknown[];
}

/**
 * Resolve a Slack user ID to an active OpsKnight user by verified Slack email.
 */
async function resolveOpsKnightUser(slackUserId: string, botToken: string) {
  try {
    let slackEmail: string | undefined;

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
      }
    }

    if (slackEmail) {
      const userByEmail = await prisma.user.findFirst({
        where: {
          email: { equals: slackEmail, mode: 'insensitive' },
          status: 'ACTIVE',
        },
        select: { id: true, name: true, email: true },
      });
      if (userByEmail) return userByEmail;
    }

    return null;
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
  const idempotency = payload.__opsknightIntentId
    ? { key: payload.__opsknightIntentId, principalId: `chatops:${user_id}` }
    : undefined;

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
      // Channel IDs are only unique inside a Slack workspace. Legacy rows did
      // not retain the workspace, so they may be used only when their service
      // is explicitly bound to the signed workspace.
      OR: [
        { slackWorkspaceId: payload.team_id },
        {
          slackWorkspaceId: null,
          service: {
            OR: [
              { slackWorkspaceId: payload.team_id },
              { slackIntegration: { workspaceId: payload.team_id } },
            ],
          },
        },
      ],
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
  const mutatingCommands = new Set(['ack', 'acknowledge', 'resolve', 'note', 'postmortem', 'who']);
  const actor =
    mutatingCommands.has(subcommand) && botToken
      ? await resolveOpsKnightUser(user_id, botToken)
      : null;
  if (mutatingCommands.has(subcommand) && !actor) {
    return {
      response_type: 'ephemeral',
      text: '⚠️ Your Slack account is not linked to an active OpsKnight account. Match the email addresses before changing incidents.',
    };
  }

  switch (subcommand) {
    case 'ack':
    case 'acknowledge': {
      let lifecycleResult;
      try {
        lifecycleResult = await executeChatOpsLifecycleCommand({
          incidentId: incident.id,
          command: 'ACKNOWLEDGE',
          actor: { id: actor!.id, name: actor!.name },
          ...(idempotency ? { idempotency } : {}),
          eventMessage: `Acknowledged via Slack ChatOps by ${actor!.name}`,
        });
      } catch (error) {
        logger.warn('[ChatOps] Slash acknowledge rejected', {
          incidentId: incident.id,
          userId: actor!.id,
          error,
        });
        return {
          response_type: 'ephemeral',
          text: `⚠️ ${chatOpsLifecycleErrorMessage(error)}`,
        };
      }

      if (!lifecycleResult.changed) {
        return {
          response_type: 'ephemeral',
          text: `ℹ️ Incident is already ${lifecycleResult.status.toLowerCase()}.`,
        };
      }

      logger.info('[ChatOps] Incident acknowledged via slash command', {
        incidentId: incident.id,
        slackUser: payload.user_name,
      });

      // Notifications/topic updates are persisted by the lifecycle outbox.
      return {
        response_type: 'in_channel',
        text: `👀 *Incident Acknowledged* by <@${user_id}>\n_${incident.title}_`,
      };
    }

    case 'resolve': {
      const resolution = args || 'Resolved via Slack ChatOps';
      let lifecycleResult;

      try {
        lifecycleResult = await executeChatOpsLifecycleCommand({
          incidentId: incident.id,
          command: 'RESOLVE',
          actor: { id: actor!.id, name: actor!.name },
          ...(idempotency ? { idempotency } : {}),
          resolutionNote: resolution,
          eventMessage: `Resolved via Slack ChatOps by ${actor!.name}: ${resolution}`,
        });
      } catch (error) {
        logger.warn('[ChatOps] Slash resolve rejected', {
          incidentId: incident.id,
          userId: actor!.id,
          error,
        });
        return {
          response_type: 'ephemeral',
          text: `⚠️ ${chatOpsLifecycleErrorMessage(error)}`,
        };
      }

      if (!lifecycleResult.changed) {
        return {
          response_type: 'ephemeral',
          text: 'ℹ️ Incident is already resolved.',
        };
      }

      logger.info('[ChatOps] Incident resolved via slash command', {
        incidentId: incident.id,
        slackUser: payload.user_name,
      });

      // Notifications/archive are persisted by the lifecycle outbox.
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

      const noteUserId = actor!.id;

      if (!noteUserId) {
        return {
          response_type: 'ephemeral',
          text: '⚠️ Could not find your OpsKnight account. Please make sure your Slack email matches your OpsKnight email.',
        };
      }

      await authorizeChatOpsIncident(incident.id, noteUserId, 'NOTE');
      await runSerializableTransaction(async tx => {
        await executeIdempotentOperation(tx, {
          scope: 'chatops-note',
          context: idempotency,
          payload: { incidentId: incident.id, userId: noteUserId, content: args },
          execute: async () => {
            await tx.incidentNote.create({
              data: { incidentId: incident.id, userId: noteUserId, content: args },
            });
            await tx.incidentEvent.create({
              data: {
                incidentId: incident.id,
                type: 'COMMENT',
                message: `Note added via Slack ChatOps by @${payload.user_name}${args ? `:\n${args}` : ''}`,
              },
            });
            return { created: true };
          },
        });
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
        await authorizeChatOpsIncident(incident.id, actor!.id, 'READ');
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
        const { executeChatOpsPostmortemCommand } =
          await import('@/lib/incidents/chatops-postmortem');
        const result = await executeChatOpsPostmortemCommand({
          incidentId: incident.id,
          actor: actor!,
          channelName: payload.channel_name,
          ...(idempotency ? { idempotency } : {}),
        });
        return {
          response_type: 'in_channel',
          text: result.created
            ? `📄 *Postmortem Draft Created!*\n*Title:* ${result.title}\n*Timeline Events Captured:* ${result.timelineCount}\n🔗 *Edit & Publish:* ${result.url}`
            : `📄 *Postmortem Draft Exists*\nTitle: *${result.title}* (${result.status})\n🔗 *Edit & Publish:* ${result.url}`,
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
