/**
 * ChatOps Slash Command Dispatcher
 * Handles /incident slash commands from Slack war-room channels.
 * Supports: ack, resolve, note, who, role, roles, postmortem, help
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSlackBotToken } from '@/lib/slack';
import { retryFetch } from '@/lib/retry';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsLifecycleCommand,
  authorizeChatOpsIncident,
  executeChatOpsNote,
  executeChatOpsRole,
} from '@/lib/incidents/chatops-lifecycle';
import {
  INCIDENT_ROLES,
  INCIDENT_ROLE_SUMMARY_SELECT,
  parseIncidentRoleKey,
  summarizeIncidentRoles,
  type IncidentRoleKey,
} from '@/lib/incidents/roles';

export type RoleCommandTarget =
  { kind: 'me' } | { kind: 'clear' } | { kind: 'slack'; slackUserId: string };

/** Parses `/incident role <role> @user|me|clear`. */
export function parseRoleCommandArgs(
  args: string
): { roleKey: IncidentRoleKey; target: RoleCommandTarget } | { error: string } {
  const usage = 'Usage: `/incident role <commander|ops-lead|comms-lead|scribe> @person|me|clear`';
  const match = args.trim().match(/^(.+?)\s+(\S+)$/);
  if (!match) return { error: usage };
  const roleKey = parseIncidentRoleKey(match[1]);
  if (!roleKey) return { error: `Unknown role \`${match[1].trim()}\`. ${usage}` };
  const target = match[2];
  if (/^me$/i.test(target)) return { roleKey, target: { kind: 'me' } };
  if (/^(clear|none|unassign)$/i.test(target)) return { roleKey, target: { kind: 'clear' } };
  // Slack sends mentions as <@U123> or <@U123|name>.
  if (target.startsWith('<@') && target.endsWith('>')) {
    const slackUserId = target.slice(2, -1).split('|')[0];
    if (/^[A-Z0-9]+$/i.test(slackUserId)) {
      return { roleKey, target: { kind: 'slack', slackUserId } };
    }
  }
  return { error: usage };
}

function formatRolesText(roles: ReturnType<typeof summarizeIncidentRoles>): string {
  const byKey = new Map(roles.map(role => [role.roleKey, role.name]));
  return INCIDENT_ROLES.map(
    role => `• *${role.label}:* ${byKey.get(role.key) ?? '_unassigned_'}`
  ).join('\n');
}

export interface SlashCommandPayload {
  command: string;
  text: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  team_id: string;
  /** Enterprise Grid org of the workspace, when there is one. */
  enterprise_id?: string;
  response_url: string;
  __opsknightIntentId?: string;
}

interface SlackResponse {
  response_type: 'in_channel' | 'ephemeral';
  text?: string;
  blocks?: unknown[];
}

/** The Slack workspace a request was signed for (and its Enterprise Grid org, when there is one). */
export interface SlackWorkspaceRef {
  teamId: string;
  enterpriseId?: string | null;
}

type SlackUserInfo = {
  team_id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_stranger?: boolean;
  enterprise_user?: { enterprise_id?: string };
  profile?: { email?: string; is_email_confirmed?: boolean };
};

/**
 * The email of a Slack account that may act as an OpsKnight user: a full, active, human member of the
 * signed workspace (or its Grid org) whose email Slack has confirmed. Guests, people from other
 * workspaces in a shared channel, bots and deactivated accounts never resolve.
 */
export function trustedSlackEmail(user: SlackUserInfo | undefined, workspace: SlackWorkspaceRef) {
  if (!user || !workspace.teamId) return undefined;
  const sameWorkspace =
    user.team_id === workspace.teamId ||
    Boolean(
      workspace.enterpriseId && user.enterprise_user?.enterprise_id === workspace.enterpriseId
    );
  if (!sameWorkspace) return undefined;
  if (user.deleted || user.is_bot || user.is_restricted || user.is_ultra_restricted)
    return undefined;
  if (user.is_stranger || user.profile?.is_email_confirmed === false) return undefined;
  return user.profile?.email?.trim() || undefined;
}

/**
 * Resolve a Slack user ID to an active OpsKnight user by verified Slack email.
 */
export async function resolveOpsKnightUser(
  slackUserId: string,
  botToken: string,
  workspace: SlackWorkspaceRef
) {
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
      if (data.ok && data.user) slackEmail = trustedSlackEmail(data.user, workspace);
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
  const workspace = { teamId: payload.team_id, enterpriseId: payload.enterprise_id || null };
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
      roleAssignments: INCIDENT_ROLE_SUMMARY_SELECT,
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
              '`/incident who` — Show incident roles and who is on-call',
              '`/incident roles` — Show who holds each incident role',
              '`/incident role commander @person|me|clear` — Assign or clear a role',
              '`/incident postmortem` — Create a postmortem draft from timeline & notes',
              '`/incident ask <question>` — Ask Squire about this incident (when enabled)',
              '`/incident investigate [focus]` — Have Squire investigate this incident’s cause (when enabled)',
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
  const mutatingCommands = new Set([
    'ack',
    'acknowledge',
    'resolve',
    'note',
    'postmortem',
    'who',
    // Squire answers under the asker's own permissions, so it needs the linked account too.
    'ask',
    'squire',
    'investigate',
    'role',
    'roles',
  ]);
  const actor =
    mutatingCommands.has(subcommand) && botToken
      ? await resolveOpsKnightUser(user_id, botToken, workspace)
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

      try {
        await executeChatOpsNote({
          incidentId: incident.id,
          actor: { id: actor!.id, name: actor!.name },
          content: args,
          provider: 'SLACK',
          ...(idempotency ? { idempotency } : {}),
        });
      } catch (error) {
        logger.warn('[ChatOps] Slash note rejected', {
          incidentId: incident.id,
          userId: actor!.id,
          error,
        });
        return {
          response_type: 'ephemeral',
          text: `⚠️ ${chatOpsLifecycleErrorMessage(error)}`,
        };
      }

      logger.info('[ChatOps] Note added via slash command', {
        incidentId: incident.id,
        slackUser: payload.user_name,
      });

      return {
        response_type: 'in_channel',
        text: `📝 *Note added* by <@${user_id}>:\n> ${args}`,
      };
    }

    case 'roles': {
      try {
        await authorizeChatOpsIncident(incident.id, actor!.id, 'READ');
      } catch (error) {
        return { response_type: 'ephemeral', text: `⚠️ ${chatOpsLifecycleErrorMessage(error)}` };
      }
      return {
        response_type: 'ephemeral',
        text: `🎖️ *Incident roles*\n${formatRolesText(summarizeIncidentRoles(incident.roleAssignments))}`,
      };
    }

    case 'role': {
      const parsed = parseRoleCommandArgs(args);
      if ('error' in parsed) return { response_type: 'ephemeral', text: `⚠️ ${parsed.error}` };
      let targetUserId: string | null = null;
      if (parsed.target.kind === 'me') targetUserId = actor!.id;
      if (parsed.target.kind === 'slack') {
        const target = botToken
          ? await resolveOpsKnightUser(parsed.target.slackUserId, botToken, workspace)
          : null;
        if (!target) {
          return {
            response_type: 'ephemeral',
            text: '⚠️ That Slack user is not linked to an active OpsKnight account (their emails must match).',
          };
        }
        targetUserId = target.id;
      }
      const label = INCIDENT_ROLES.find(role => role.key === parsed.roleKey)!.label;
      try {
        const result = await executeChatOpsRole({
          incidentId: incident.id,
          actor: { id: actor!.id, name: actor!.name },
          roleKey: parsed.roleKey,
          targetUserId,
          provider: 'SLACK',
          ...(idempotency ? { idempotency } : {}),
        });
        if (!result.changed) {
          return {
            response_type: 'ephemeral',
            text: targetUserId
              ? `ℹ️ ${result.userName} is already ${label.toLowerCase()}.`
              : `ℹ️ Nobody holds the ${label.toLowerCase()} role.`,
          };
        }
        return {
          response_type: 'in_channel',
          text: targetUserId
            ? `🎖️ *${result.userName}* is now *${label}* (set by <@${user_id}>)`
            : `🎖️ *${label}* role cleared by <@${user_id}>`,
        };
      } catch (error) {
        logger.warn('[ChatOps] Slash role rejected', {
          incidentId: incident.id,
          userId: actor!.id,
          error,
        });
        return { response_type: 'ephemeral', text: `⚠️ ${chatOpsLifecycleErrorMessage(error)}` };
      }
    }

    case 'who': {
      // Query on-call schedule for the service
      try {
        await authorizeChatOpsIncident(incident.id, actor!.id, 'READ');
        const rolesText = `🎖️ *Incident roles*\n${formatRolesText(summarizeIncidentRoles(incident.roleAssignments))}`;
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
            text: `${rolesText}\n\nℹ️ No escalation policy configured for *${incident.service.name}*.`,
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
          text: `${rolesText}\n\n📋 *On-Call for ${incident.service.name}:*\n${lines.join('\n')}`,
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

    case 'ask':
    case 'squire': {
      // Answered privately to the asker; suggestions carry Confirm buttons only they can use.
      const { answerSlackSquireSlash } = await import('@/lib/chatops/squire/slack');
      return answerSlackSquireSlash({ userId: actor!.id, incidentId: incident.id, question: args });
    }

    case 'investigate': {
      // Investigation mode on this channel's incident, under the asker's own access to it.
      const { answerSlackSquireSlash } = await import('@/lib/chatops/squire/slack');
      return answerSlackSquireSlash({
        userId: actor!.id,
        incidentId: incident.id,
        question: `investigate ${args}`,
      });
    }

    default:
      return {
        response_type: 'ephemeral',
        text: `❓ Unknown command: \`${subcommand}\`. Try \`/incident help\` for available commands.`,
      };
  }
}
