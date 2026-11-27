/**
 * ChatOps Slash Command Dispatcher
 * Handles /incident slash commands. `help`, `list`, `oncall` and `declare` work in any channel; the
 * rest act on the war-room channel's incident: ack, resolve, note, who, role, roles, postmortem,
 * ask, investigate.
 */

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSlackBotToken } from '@/lib/slack';
import { retryFetch } from '@/lib/retry';
import { z } from 'zod/v3';
import { normalizeError } from '@/lib/errors';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import { escapeSlack } from '@/lib/chatops/squire/render';
import { SLACK_COMMAND_USAGE_HINT } from '@/lib/slack/app-manifest';
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

/** The `/incident` usage hint, for the Slack app manifest (A3 owns the manifest constant). */
/** Same text as the manifest's `/incident` usage hint, so Slack's autocomplete and `help` agree. */
export const SLACK_INCIDENT_COMMAND_USAGE_HINT = SLACK_COMMAND_USAGE_HINT;

/** Subcommands that work in any channel, not only in a war room. */
export const ANYWHERE_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'help',
  'list',
  'oncall',
  'on-call',
  'declare',
]);

/** `/incident <subcommand> <args>`: lower-cased subcommand (default `help`), raw args. */
export function parseSlashCommandText(text: string): { subcommand: string; args: string } {
  const trimmed = text.trim();
  const firstSpaceIndex = trimmed.search(/\s/);
  const subcommand =
    (firstSpaceIndex === -1 ? trimmed : trimmed.slice(0, firstSpaceIndex)).toLowerCase() || 'help';
  return { subcommand, args: firstSpaceIndex === -1 ? '' : trimmed.slice(firstSpaceIndex).trim() };
}

export const SLASH_HELP_LINES = [
  '*Anywhere*',
  '`/incident declare` — Open a form to declare a new incident',
  '`/incident list [service]` — Your open incidents, or a service’s',
  '`/incident oncall [service]` — Who is on call for a service',
  '`/incident help` — Show this help message',
  '*In a war-room channel*',
  '`/incident ack` — Acknowledge this incident',
  '`/incident resolve [summary]` — Resolve with optional summary',
  '`/incident note <message>` — Add an incident note',
  '`/incident who` — Show incident roles and who is on-call',
  '`/incident roles` — Show who holds each incident role',
  '`/incident role commander @person|me|clear` — Assign or clear a role',
  '`/incident postmortem` — Create a postmortem draft from timeline & notes',
  '`/incident ask <question>` — Ask Squire about this incident (when enabled)',
  '`/incident investigate [focus]` — Have Squire investigate this incident’s cause (when enabled)',
  'Mention @OpsKnight or type @Squire in a war room to ask Squire.',
];

/**
 * In the durable intent worker, a transient failure (DB timeout, serialization conflict, internal
 * error) must throw so the intent is retried instead of recording a "try again" reply as the
 * completed effect. Permission and validation errors are final and answered.
 */
function rethrowIfTransient(error: unknown, payload: { __opsknightIntentId?: string }): void {
  if (payload.__opsknightIntentId && normalizeError(error).retryable) throw error;
}

const NOT_LINKED_REPLY: SlackResponse = {
  response_type: 'ephemeral',
  text: '⚠️ Your Slack account is not linked to an active OpsKnight account. Match the email addresses before changing incidents.',
};

/** Escalation-policy steps with the people on call now, one line each; null without a policy. */
async function onCallLines(escalationPolicyId: string | null): Promise<string[] | null> {
  const policy = escalationPolicyId
    ? await prisma.escalationPolicy.findUnique({
        where: { id: escalationPolicyId },
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
  if (!policy?.steps?.length) return null;
  return Promise.all(
    policy.steps.map(async (step, i) => {
      const targets: string[] = [];
      if (step.targetUser) targets.push(`👤 ${escapeSlack(step.targetUser.name)}`);
      if (step.targetTeam) {
        const members = step.targetTeam.members.map(m => escapeSlack(m.user.name)).join(', ');
        targets.push(`👥 ${escapeSlack(step.targetTeam.name)} (${members})`);
      }
      if (step.targetSchedule) {
        const scheduleName = escapeSlack(step.targetSchedule.name);
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
              `📅 ${scheduleName} (On-call: ${users.map(u => escapeSlack(u.name)).join(', ')})`
            );
          } else {
            targets.push(`📅 ${scheduleName} (No one on-call)`);
          }
        } catch {
          targets.push(`📅 ${scheduleName}`);
        }
      }
      return `*Step ${i + 1}* (${step.delayMinutes}min delay): ${targets.join(', ') || 'Schedule-based'}`;
    })
  );
}

/** A service the person may read, by id or (case-insensitive) name; exact names win over partial. */
async function findReadableService(userId: string, query: string) {
  const { resolveUserActor } = await import('@/lib/authorization-actors');
  const { serviceReadWhere } = await import('@/lib/authorization-filters');
  const actor = await resolveUserActor(userId);
  if (!actor) return null;
  const readable = serviceReadWhere(actor);
  const name = query.trim().replace(/^#/, '').slice(0, 200);
  if (!name) return null;
  const select = { id: true, name: true, escalationPolicyId: true } as const;
  return (
    (await prisma.service.findFirst({
      where: {
        AND: [readable, { OR: [{ id: name }, { name: { equals: name, mode: 'insensitive' } }] }],
      },
      select,
    })) ??
    (await prisma.service.findFirst({
      where: { AND: [readable, { name: { contains: name, mode: 'insensitive' } }] },
      select,
      orderBy: { name: 'asc' },
    }))
  );
}

async function handleOnCallCommand(
  actorId: string,
  args: string,
  channelService: { id: string; name: string; escalationPolicyId: string | null } | null
): Promise<SlackResponse> {
  const service = args ? await findReadableService(actorId, args) : channelService;
  if (!service) {
    return {
      response_type: 'ephemeral',
      text: args
        ? `⚠️ No service you can see matches \`${escapeSlack(args.slice(0, 100))}\`.`
        : 'Usage: `/incident oncall <service>` (in a war room the service is optional).',
    };
  }
  const lines = await onCallLines(service.escalationPolicyId);
  return {
    response_type: 'ephemeral',
    text: lines
      ? `📋 *On-Call for ${escapeSlack(service.name)}:*\n${lines.join('\n')}`
      : `ℹ️ No escalation policy configured for *${escapeSlack(service.name)}*.`,
  };
}

async function handleListCommand(actorId: string, args: string): Promise<SlackResponse> {
  const { resolveUserActor } = await import('@/lib/authorization-actors');
  const { incidentReadWhere } = await import('@/lib/authorization-filters');
  const { getBaseUrl } = await import('@/lib/env-validation');
  const actor = await resolveUserActor(actorId);
  if (!actor) return NOT_LINKED_REPLY;
  const service = args ? await findReadableService(actorId, args) : null;
  if (args && !service) {
    return {
      response_type: 'ephemeral',
      text: `⚠️ No service you can see matches \`${escapeSlack(args.slice(0, 100))}\`.`,
    };
  }
  const findOpen = (filter: Prisma.IncidentWhereInput) =>
    prisma.incident.findMany({
      where: {
        AND: [incidentReadWhere(actor), { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, filter],
      },
      select: {
        id: true,
        title: true,
        status: true,
        urgency: true,
        service: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  let incidents = await findOpen(service ? { serviceId: service.id } : { assigneeId: actorId });
  let scope = service ? `on *${escapeSlack(service.name)}*` : 'assigned to you';
  // Nothing of your own: show what is burning anyway rather than a bare "all clear".
  if (incidents.length === 0 && !service) {
    incidents = await findOpen({});
    scope = 'you can see (none are assigned to you)';
  }
  if (incidents.length === 0)
    return { response_type: 'ephemeral', text: `✅ No open incidents ${scope}.` };
  const base = getBaseUrl().replace(/\/+$/, '');
  const lines = incidents.map(
    incident =>
      `${incident.status === 'ACKNOWLEDGED' ? '🟡' : '🔴'} <${base}/incidents/${incident.id}|${escapeSlack(incident.title)}> · ${escapeSlack(incident.service.name)} · ${incident.urgency.toLowerCase()} urgency`
  );
  return {
    response_type: 'ephemeral',
    text: `*Open incidents ${scope}*\n${lines.join('\n')}`,
  };
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
  const { subcommand, args } = parseSlashCommandText(text);

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

  // Commands that work in any channel run before the war-room check.
  if (subcommand === 'help') {
    return {
      response_type: 'ephemeral',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🛡️ OpsKnight Incident Commands', emoji: true },
        },
        { type: 'section', text: { type: 'mrkdwn', text: SLASH_HELP_LINES.join('\n') } },
      ],
    };
  }

  if (subcommand === 'declare') {
    // The modal is opened by the commands route (Slack's trigger_id expires in three seconds).
    return {
      response_type: 'ephemeral',
      text: 'ℹ️ Run `/incident declare` again to open the form.',
    };
  }

  if (ANYWHERE_SUBCOMMANDS.has(subcommand)) {
    const token = incident
      ? await getSlackBotToken(incident.service.id)
      : await workspaceBotToken(payload.team_id);
    const listActor = token ? await resolveOpsKnightUser(user_id, token, workspace) : null;
    if (!listActor) return NOT_LINKED_REPLY;
    try {
      return subcommand === 'list'
        ? await handleListCommand(listActor.id, args)
        : await handleOnCallCommand(listActor.id, args, incident?.service ?? null);
    } catch (error) {
      logger.warn('[ChatOps] Slash command failed', { subcommand, error });
      rethrowIfTransient(error, payload);
      return { response_type: 'ephemeral', text: `⚠️ ${chatOpsLifecycleErrorMessage(error)}` };
    }
  }

  if (!incident) {
    return {
      response_type: 'ephemeral',
      text: '⚠️ No incident is linked to this channel. This command only works in OpsKnight war-room channels. Try `/incident list`, `/incident oncall <service>` or `/incident declare` anywhere.',
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
  if (mutatingCommands.has(subcommand) && !actor) return NOT_LINKED_REPLY;
  const incidentTitle = escapeSlack(incident.title ?? '');

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
        rethrowIfTransient(error, payload);
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
        text: `👀 *Incident Acknowledged* by <@${user_id}>\n_${incidentTitle}_`,
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
        rethrowIfTransient(error, payload);
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
        text: `✅ *Incident Resolved* by <@${user_id}>\n_${escapeSlack(resolution)}_`,
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
        rethrowIfTransient(error, payload);
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
        text: `📝 *Note added* by <@${user_id}>:\n> ${escapeSlack(args).replace(/\n/g, '\n> ')}`,
      };
    }

    case 'roles': {
      try {
        await authorizeChatOpsIncident(incident.id, actor!.id, 'READ');
      } catch (error) {
        rethrowIfTransient(error, payload);
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
              ? `ℹ️ ${escapeSlack(result.userName ?? '')} is already ${label.toLowerCase()}.`
              : `ℹ️ Nobody holds the ${label.toLowerCase()} role.`,
          };
        }
        return {
          response_type: 'in_channel',
          text: targetUserId
            ? `🎖️ *${escapeSlack(result.userName ?? '')}* is now *${label}* (set by <@${user_id}>)`
            : `🎖️ *${label}* role cleared by <@${user_id}>`,
        };
      } catch (error) {
        logger.warn('[ChatOps] Slash role rejected', {
          incidentId: incident.id,
          userId: actor!.id,
          error,
        });
        rethrowIfTransient(error, payload);
        return { response_type: 'ephemeral', text: `⚠️ ${chatOpsLifecycleErrorMessage(error)}` };
      }
    }

    case 'who': {
      // Query on-call schedule for the service
      try {
        await authorizeChatOpsIncident(incident.id, actor!.id, 'READ');
        const rolesText = `🎖️ *Incident roles*\n${formatRolesText(summarizeIncidentRoles(incident.roleAssignments))}`;
        const lines = await onCallLines(incident.service.escalationPolicyId);
        if (!lines) {
          return {
            response_type: 'ephemeral',
            text: `${rolesText}\n\nℹ️ No escalation policy configured for *${escapeSlack(incident.service.name)}*.`,
          };
        }
        return {
          response_type: 'ephemeral',
          text: `${rolesText}\n\n📋 *On-Call for ${escapeSlack(incident.service.name)}:*\n${lines.join('\n')}`,
        };
      } catch (error) {
        logger.error('[ChatOps] Failed to query on-call', { error });
        rethrowIfTransient(error, payload);
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
            ? `📄 *Postmortem Draft Created!*\n*Title:* ${escapeSlack(result.title)}\n*Timeline Events Captured:* ${result.timelineCount}\n🔗 *Edit & Publish:* ${result.url}`
            : `📄 *Postmortem Draft Exists*\nTitle: *${escapeSlack(result.title)}* (${result.status})\n🔗 *Edit & Publish:* ${result.url}`,
        };
      } catch (pmErr) {
        logger.error('[ChatOps] Failed to create postmortem via slash command', { error: pmErr });
        rethrowIfTransient(pmErr, payload);
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
        text: `❓ Unknown command: \`${escapeSlack(subcommand.slice(0, 50))}\`. Try \`/incident help\` for available commands.`,
      };
  }
}

// ── /incident declare ─────────────────────────────────────────────────────

export const SLACK_DECLARE_CALLBACK_ID = 'opsknight_incident_declare';
const DECLARE_BLOCKS = {
  title: { block: 'declare_title', action: 'value' },
  service: { block: 'declare_service', action: 'value' },
  urgency: { block: 'declare_urgency', action: 'value' },
  description: { block: 'declare_description', action: 'value' },
} as const;

const declareSubmissionSchema = z.object({
  title: z.string().trim().min(3, 'Give the incident a title of at least 3 characters.').max(200),
  serviceId: z.string().trim().min(1, 'Pick the affected service.').max(64),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  description: z.string().trim().max(3000).optional(),
});
export type SlackDeclareInput = z.infer<typeof declareSubmissionSchema>;

const declareMetadataSchema = z.object({
  responseUrl: z.string().max(500).optional(),
  channelId: z.string().max(64).optional(),
});

/** The bot token of the installation for this Slack workspace (rotating tokens refreshed). */
async function workspaceBotToken(teamId: string): Promise<string | null> {
  const installation = teamId
    ? await prisma.slackIntegration.findFirst({
        where: { workspaceId: teamId, enabled: true },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, botToken: true, refreshToken: true, tokenExpiresAt: true },
      })
    : null;
  if (installation?.botToken) {
    const { readSlackBotToken } = await import('@/app/api/slack/oauth/token-rotation');
    return readSlackBotToken(installation).catch(() => null);
  }
  return getSlackBotToken();
}

const plain = (text: string) => ({ type: 'plain_text' as const, text: text.slice(0, 75) });

/** The declare modal; `services` become the select's options (Slack allows 100). */
export function buildSlackDeclareModal(input: {
  services: ReadonlyArray<{ id: string; name: string }>;
  responseUrl?: string;
  channelId?: string;
}) {
  const metadata = JSON.stringify({
    ...(input.responseUrl ? { responseUrl: input.responseUrl } : {}),
    ...(input.channelId ? { channelId: input.channelId } : {}),
  });
  return {
    type: 'modal',
    callback_id: SLACK_DECLARE_CALLBACK_ID,
    title: plain('Declare an incident'),
    submit: plain('Declare'),
    close: plain('Cancel'),
    ...(metadata.length <= 3000 ? { private_metadata: metadata } : {}),
    blocks: [
      {
        type: 'input',
        block_id: DECLARE_BLOCKS.title.block,
        label: plain('Title'),
        element: {
          type: 'plain_text_input',
          action_id: DECLARE_BLOCKS.title.action,
          max_length: 200,
          placeholder: plain('Checkout API returns 500s'),
        },
      },
      {
        type: 'input',
        block_id: DECLARE_BLOCKS.service.block,
        label: plain('Service'),
        element: {
          type: 'static_select',
          action_id: DECLARE_BLOCKS.service.action,
          placeholder: plain('Pick the affected service'),
          options: input.services.slice(0, 100).map(service => ({
            text: plain(service.name),
            value: service.id,
          })),
        },
      },
      {
        type: 'input',
        block_id: DECLARE_BLOCKS.urgency.block,
        label: plain('Urgency'),
        element: {
          type: 'static_select',
          action_id: DECLARE_BLOCKS.urgency.action,
          initial_option: { text: plain('High'), value: 'HIGH' },
          options: [
            { text: plain('High'), value: 'HIGH' },
            { text: plain('Medium'), value: 'MEDIUM' },
            { text: plain('Low'), value: 'LOW' },
          ],
        },
      },
      {
        type: 'input',
        block_id: DECLARE_BLOCKS.description.block,
        optional: true,
        label: plain('Description'),
        element: {
          type: 'plain_text_input',
          action_id: DECLARE_BLOCKS.description.action,
          multiline: true,
          max_length: 3000,
        },
      },
    ],
  };
}

type SlackViewState = {
  values?: Record<
    string,
    Record<string, { value?: unknown; selected_option?: { value?: unknown } | null }>
  >;
};

/** Validates a declare submission; errors are keyed by block id, as Slack's `response_action: errors` wants. */
export function parseSlackDeclareSubmission(
  view: { state?: SlackViewState } | undefined
): { ok: true; value: SlackDeclareInput } | { ok: false; errors: Record<string, string> } {
  const values = view?.state?.values ?? {};
  // Each block holds one input; looked up by exact id so a crafted payload cannot reach other keys.
  const read = (block: string) => {
    const entry = Object.entries(values).find(([id]) => id === block)?.[1];
    const field = entry ? Object.values(entry)[0] : undefined;
    const raw = field?.selected_option?.value ?? field?.value;
    return typeof raw === 'string' ? raw : undefined;
  };
  const parsed = declareSubmissionSchema.safeParse({
    title: read(DECLARE_BLOCKS.title.block) ?? '',
    serviceId: read(DECLARE_BLOCKS.service.block) ?? '',
    urgency: read(DECLARE_BLOCKS.urgency.block) ?? 'HIGH',
    description: read(DECLARE_BLOCKS.description.block) || undefined,
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const blockForField = new Map<unknown, string>([
    ['title', DECLARE_BLOCKS.title.block],
    ['serviceId', DECLARE_BLOCKS.service.block],
    ['urgency', DECLARE_BLOCKS.urgency.block],
    ['description', DECLARE_BLOCKS.description.block],
  ]);
  const errors = new Map<string, string>();
  for (const issue of parsed.error.issues) {
    const block = blockForField.get(issue.path[0]);
    if (block && !errors.has(block)) errors.set(block, issue.message);
  }
  return { ok: false, errors: Object.fromEntries(errors) };
}

/**
 * Commands route: opens the declare modal inline, because Slack's trigger_id is only valid for three
 * seconds (the queued worker would be too late). Returns the reply for Slack, or null for an empty 200.
 */
export async function openSlackDeclareModal(payload: {
  team_id: string;
  channel_id?: string;
  response_url?: string;
  trigger_id?: string;
}): Promise<SlackResponse | null> {
  const fallback: SlackResponse = {
    response_type: 'ephemeral',
    text: '⚠️ Could not open the declare form. Try again, or declare the incident in OpsKnight.',
  };
  if (!payload.trigger_id) return fallback;
  try {
    const [token, services] = await Promise.all([
      workspaceBotToken(payload.team_id),
      prisma.service.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 100,
      }),
    ]);
    if (!token) return fallback;
    if (services.length === 0)
      return { response_type: 'ephemeral', text: 'ℹ️ Create a service in OpsKnight first.' };
    const response = await fetch('https://slack.com/api/views.open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        trigger_id: payload.trigger_id,
        view: buildSlackDeclareModal({
          services,
          responseUrl: payload.response_url,
          channelId: payload.channel_id,
        }),
      }),
      signal: AbortSignal.timeout(2_000),
    });
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (data.ok) return null;
    logger.warn('[ChatOps] Slack declare modal did not open', { error: data.error });
    return fallback;
  } catch (error) {
    logger.warn('[ChatOps] Slack declare modal failed', {
      error: error instanceof Error ? error.name : 'error',
    });
    return fallback;
  }
}

export interface SlackDeclareSubmissionPayload extends SlackDeclareInput {
  __kind: 'DECLARE_SUBMISSION';
  team_id: string;
  enterprise_id?: string;
  user_id: string;
  channel_id?: string;
  response_url?: string;
  __opsknightIntentId?: string;
}

/**
 * Actions route: a declare `view_submission`. Invalid input is answered inline (Slack shows it on the
 * fields); valid input is queued as a durable intent and the modal closes.
 */
export async function acceptSlackDeclareSubmission(
  payload: {
    team?: { id?: unknown };
    enterprise?: { id?: unknown } | null;
    user?: { id?: unknown };
    view?: { state?: SlackViewState; private_metadata?: unknown };
  },
  signature: string
): Promise<Response> {
  const parsed = parseSlackDeclareSubmission(payload.view);
  if (!parsed.ok) return Response.json({ response_action: 'errors', errors: parsed.errors });
  const teamId = typeof payload.team?.id === 'string' ? payload.team.id : '';
  const userId = typeof payload.user?.id === 'string' ? payload.user.id : '';
  if (!teamId || !userId)
    return Response.json({ error: 'Missing Slack workspace' }, { status: 400 });
  let metadata: z.infer<typeof declareMetadataSchema> = {};
  try {
    const raw = payload.view?.private_metadata;
    const meta = declareMetadataSchema.safeParse(
      typeof raw === 'string' && raw ? JSON.parse(raw) : {}
    );
    if (meta.success) metadata = meta.data;
  } catch {
    // No reply target; the incident is still declared.
  }
  const enterpriseId = typeof payload.enterprise?.id === 'string' ? payload.enterprise.id : '';
  const queued: SlackDeclareSubmissionPayload = {
    __kind: 'DECLARE_SUBMISSION',
    ...parsed.value,
    team_id: teamId,
    ...(enterpriseId ? { enterprise_id: enterpriseId } : {}),
    user_id: userId,
    ...(metadata.channelId ? { channel_id: metadata.channelId } : {}),
    ...(metadata.responseUrl ? { response_url: metadata.responseUrl } : {}),
  };
  try {
    await enqueueChatOpsIntent({
      kind: 'INTERACTIVE_ACTION',
      signature,
      workspaceId: teamId,
      channelId: metadata.channelId ?? '',
      slackUserId: userId,
      payload: { ...queued },
    });
  } catch (error) {
    logger.error('[ChatOps] Could not queue a Slack declare submission', {
      error: error instanceof Error ? error.name : 'error',
    });
    return Response.json({
      response_action: 'errors',
      errors: {
        [DECLARE_BLOCKS.title.block]: 'OpsKnight could not save this right now. Try again.',
      },
    });
  }
  return new Response(null, { status: 200 });
}

/**
 * Worker: creates the incident through the normal creation path, under the declaring person's own
 * permission to create incidents on that service. The reply goes to the slash command's response_url.
 */
export async function handleSlackDeclareSubmission(
  payload: SlackDeclareSubmissionPayload
): Promise<SlackResponse> {
  const parsed = declareSubmissionSchema.safeParse(payload);
  if (!parsed.success)
    return { response_type: 'ephemeral', text: '⚠️ The declare form was incomplete.' };
  const input = parsed.data;
  const workspace = { teamId: payload.team_id, enterpriseId: payload.enterprise_id || null };
  const token = await workspaceBotToken(payload.team_id);
  const actor = token ? await resolveOpsKnightUser(payload.user_id, token, workspace) : null;
  if (!actor) return NOT_LINKED_REPLY;
  try {
    const { resolveUserActor } = await import('@/lib/authorization-actors');
    const { authorize, AUTHORIZATION_ACTIONS } = await import('@/lib/authorization-policy');
    const authActor = await resolveUserActor(actor.id);
    const service = await prisma.service.findUnique({
      where: { id: input.serviceId },
      select: { id: true, name: true, teamId: true },
    });
    if (!service) return { response_type: 'ephemeral', text: '⚠️ That service no longer exists.' };
    const allowed =
      authActor &&
      authorize({ actor: authActor, action: AUTHORIZATION_ACTIONS.INCIDENT_CREATE }).allowed &&
      authorize({
        actor: authActor,
        action: AUTHORIZATION_ACTIONS.INCIDENT_CREATE,
        resource: { type: 'service', teamId: service.teamId },
      }).allowed;
    if (!allowed) {
      return {
        response_type: 'ephemeral',
        text: `🚫 You do not have permission to declare incidents on *${escapeSlack(service.name)}*.`,
      };
    }
    const { executeIdempotentIncidentCreation } =
      await import('@/lib/incidents/idempotent-commands');
    const execution = await executeIdempotentIncidentCreation(
      {
        title: input.title,
        description: input.description ?? null,
        urgency: input.urgency,
        serviceId: service.id,
        teamId: service.teamId ?? null,
        source: 'WEB',
        actor: { id: actor.id, name: actor.name ?? undefined },
      },
      payload.__opsknightIntentId
        ? { key: payload.__opsknightIntentId, principalId: `chatops:${payload.user_id}` }
        : undefined
    );
    const { getBaseUrl } = await import('@/lib/env-validation');
    const url = `${getBaseUrl().replace(/\/+$/, '')}/incidents/${execution.value.id}`;
    logger.info('[ChatOps] Incident declared from Slack', {
      incidentId: execution.value.id,
      outcome: execution.value.outcome,
    });
    return {
      response_type: 'ephemeral',
      text:
        execution.value.outcome === 'CREATED'
          ? `🚨 Declared <${url}|${escapeSlack(input.title)}> on *${escapeSlack(service.name)}*. A war room opens if the service's policy calls for one.`
          : `ℹ️ This matched an open incident, so it was added there: <${url}|open incident>.`,
    };
  } catch (error) {
    logger.warn('[ChatOps] Slack declare failed', { error });
    rethrowIfTransient(error, payload);
    return { response_type: 'ephemeral', text: `⚠️ ${chatOpsLifecycleErrorMessage(error)}` };
  }
}
