import 'server-only';

import type { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getBaseUrl } from '@/lib/env-validation';
import { normalizeError, toPublicAppError } from '@/lib/errors';
import { emitAuditEvent } from '@/lib/audit';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import {
  enqueueChatOpsIntent,
  payloadDigestFromPayload,
  processInlineChatOpsIntent,
} from '@/lib/chatops/intents';
import { executeChatOpsCommand } from '@/lib/chatops/commands';
import { getIncidentChatOpsCapabilities } from '@/lib/chatops/incident-capabilities';
import { chatOpsKindForTeamsVerb } from '@/lib/chatops/teams-action-map';
import { buildMicrosoftTeamsIncidentCard } from './cards';
import { parseMicrosoftTeamsAction, TEAMS_CHATOPS_VERBS } from './action-schema';
import { createMicrosoftTeamsIdentityChallenge, resolveMicrosoftTeamsUser } from './identity';
import {
  teamsActionCard,
  teamsActionError,
  teamsActionSuccess,
  type TeamsInvokeResponse,
} from './invoke-response';

export type MicrosoftTeamsActionActivity = {
  id?: string;
  replyToId?: string;
  serviceUrl?: string;
  from?: { id?: string; aadObjectId?: string; name?: string };
  conversation?: { id?: string };
  channelData?: {
    tenant?: { id?: string };
    team?: { id?: string; aadGroupId?: string };
    channel?: { id?: string };
  };
  value?: unknown;
};

function publicError(error: unknown): TeamsInvokeResponse {
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    const customMessage =
      firstIssue && firstIssue.code === 'custom' && firstIssue.message
        ? firstIssue.message
        : firstIssue &&
            firstIssue.message &&
            !firstIssue.message.includes('Required') &&
            !firstIssue.message.includes('Expected') &&
            !firstIssue.message.includes('Unrecognized key')
          ? firstIssue.message
          : 'This Teams action is invalid or outdated.';
    return teamsActionError(400, 'InvalidAction', customMessage);
  }
  const normalized = normalizeError(error);
  const exposed = toPublicAppError(normalized);
  const status = [400, 401, 403, 404, 409, 429, 503].includes(normalized.status)
    ? normalized.status
    : 500;
  const code = status === 403 ? 'ActionDenied' : exposed.code;
  return teamsActionError(
    status,
    code,
    exposed.message || 'OpsKnight could not apply this action.'
  );
}

export async function handleMicrosoftTeamsAdaptiveCardAction(input: {
  activity: MicrosoftTeamsActionActivity;
  verifiedTenantId: string;
}): Promise<TeamsInvokeResponse> {
  try {
    const action = parseMicrosoftTeamsAction(input.activity.value);
    const tenantId = input.verifiedTenantId.trim();
    const teamId =
      input.activity.channelData?.team?.aadGroupId?.trim() ||
      input.activity.channelData?.team?.id?.trim() ||
      input.activity.conversation?.id?.trim() ||
      '';
    const channelId = input.activity.channelData?.channel?.id?.trim() ?? '';
    const providerUserId = input.activity.from?.id?.trim() ?? '';
    const activityId = input.activity.id?.trim() ?? '';
    if (!tenantId || !teamId || !channelId || !providerUserId || !activityId) {
      return teamsActionError(
        400,
        'InvalidContext',
        'Teams did not provide the required action context.'
      );
    }

    const { incidentId, destinationId, messageGeneration, warRoomId } = action.data;
    const isRefresh = action.action.verb === TEAMS_CHATOPS_VERBS.REFRESH;
    const limit = await checkRateLimit(
      `chatops:teams:${isRefresh ? 'refresh' : 'mutation'}:${tenantId}:${providerUserId}`,
      isRefresh ? 120 : 30,
      60_000
    );
    if (!limit.allowed)
      return teamsActionError(429, 'RateLimited', 'Too many Teams actions. Please retry shortly.');
    const [config, destination, incident, canonical, warRoom] = await Promise.all([
      prisma.microsoftTeamsConfig.findFirst({
        where: { enabled: true, interactiveEnabled: true },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.microsoftTeamsDestination.findUnique({
        where: { id: destinationId },
        include: { installation: true },
      }),
      prisma.incident.findUnique({
        where: { id: incidentId },
        include: { service: { select: { name: true } }, assignee: { select: { name: true } } },
      }),
      prisma.microsoftTeamsIncidentMessage.findUnique({
        where: { incidentId_destinationId: { incidentId, destinationId } },
      }),
      warRoomId
        ? prisma.incidentWarRoom.findFirst({
            where: { id: warRoomId, incidentId, provider: 'MICROSOFT_TEAMS' },
          })
        : Promise.resolve(null),
    ]);
    if (
      !config ||
      !incident ||
      !destination?.enabled ||
      !destination.interactiveEnabled ||
      !destination.installation?.enabled
    ) {
      return teamsActionError(
        403,
        'InteractiveDisabled',
        'Microsoft Teams interactive actions are currently disabled.'
      );
    }
    const destinationRouteMatches =
      destination.tenantId === tenantId &&
      destination.teamId === teamId &&
      destination.channelId === channelId &&
      incident?.serviceId === destination.serviceId;
    const warRoomDestinationBound = Boolean(
      warRoom &&
      warRoom.destinationId === destinationId &&
      incident.serviceId === destination.serviceId &&
      (!warRoom.installationId || warRoom.installationId === destination.installationId) &&
      (!warRoom.providerTenantId || warRoom.providerTenantId === destination.tenantId) &&
      (!warRoom.providerContainerId || warRoom.providerContainerId === destination.teamId)
    );
    const warRoomRouteMatches = Boolean(
      warRoom &&
      warRoom.state === 'READY' &&
      warRoom.providerTenantId === tenantId &&
      warRoom.providerContainerId === teamId &&
      warRoom.providerChannelId === channelId &&
      warRoomDestinationBound
    );
    // P1 fencing: when warRoomId is present, only READY war-room authority counts; no fallback to generic destination.
    const routeMatches = warRoomId ? warRoomRouteMatches : destinationRouteMatches;
    const messageMatches = warRoom
      ? warRoom.messageGeneration === messageGeneration &&
        (!input.activity.conversation?.id ||
          warRoom.commandConversationId === input.activity.conversation.id) &&
        (!input.activity.replyToId || warRoom.commandMessageId === input.activity.replyToId)
      : canonical &&
        canonical.messageGeneration === messageGeneration &&
        (!input.activity.conversation?.id ||
          canonical.conversationId === input.activity.conversation.id) &&
        (!input.activity.replyToId || canonical.messageId === input.activity.replyToId);
    if (!routeMatches || !messageMatches) {
      return teamsActionError(
        409,
        'StaleCard',
        'This Teams card is no longer the active destination for this incident.'
      );
    }

    const identityInput = {
      tenantId,
      providerUserId,
      aadObjectId: input.activity.from?.aadObjectId?.trim() || null,
      displayName: input.activity.from?.name?.trim() || null,
    };
    const linked = await resolveMicrosoftTeamsUser(identityInput);
    addOperationalMetric('opsknight_chatops_identity_resolution_total', 1, {
      provider: 'MICROSOFT_TEAMS',
      result: linked ? 'linked' : 'unlinked',
    });
    if (!linked) {
      const token = await createMicrosoftTeamsIdentityChallenge(identityInput);
      const url = `${getBaseUrl().replace(/\/+$/, '')}/settings/chatops/link?token=${encodeURIComponent(token)}`;
      return teamsActionError(
        401,
        'AccountLinkRequired',
        `Link your OpsKnight account, then retry this action: ${url}`
      );
    }

    const signature = `${tenantId}:${activityId}`;
    const canonicalPayload = {
      action,
      tenantId,
      teamId,
      channelId,
      providerUserId,
      userId: linked.userId,
    };
    const payloadDigest = payloadDigestFromPayload(canonicalPayload);
    // prettier-ignore
    const snoozedUntil = action.action.verb === TEAMS_CHATOPS_VERBS.SNOOZE
      ? new Date(Date.now() + (action.data as unknown as { minutes: number }).minutes * 60_000).toISOString()
      : undefined;
    const payload = { ...canonicalPayload, ...(snoozedUntil ? { snoozedUntil } : {}) };
    const intent = await enqueueChatOpsIntent({
      provider: 'MICROSOFT_TEAMS',
      kind: 'INTERACTIVE_ACTION',
      signature,
      workspaceId: tenantId,
      channelId,
      providerUserId,
      payload,
      responseMode: 'INLINE',
      payloadDigest,
      providerTenantId: tenantId,
      providerConversationId: input.activity.conversation?.id,
      providerChannelId: channelId,
      providerActivityId: activityId,
      providerObjectId: identityInput.aadObjectId ?? undefined,
    });
    if (intent.duplicate)
      addOperationalMetric('opsknight_chatops_duplicate_total', 1, {
        provider: 'MICROSOFT_TEAMS',
        verb: action.action.verb,
      });

    const response = await processInlineChatOpsIntent(
      intent.id,
      async ({ intentId, payload: persistedPayload }) => {
        const idempotency = {
          key: intentId,
          principalId: `chatops:microsoft-teams:${tenantId}:${providerUserId}`,
        };
        const actionData = action.data as typeof action.data & {
          resolutionNote?: string;
          note?: string;
          priority?: string;
          minutes?: number;
          reason?: string;
        };
        const semanticKind = chatOpsKindForTeamsVerb(action.action.verb);
        let result: TeamsInvokeResponse;
        if (!semanticKind) {
          throw new ZodError([
            { code: 'custom', path: ['verb'], message: 'Unknown Teams verb' } as never,
          ]);
        }
        switch (semanticKind) {
          case 'REFRESH': {
            const capabilities = await getIncidentChatOpsCapabilities({
              incidentId,
              userId: linked.userId,
            });
            const eventType =
              incident.status === 'RESOLVED'
                ? 'resolved'
                : incident.acknowledgedAt
                  ? 'acknowledged'
                  : 'triggered';
            const { getIncidentMeeting } =
              await import('@/lib/incident-collaboration/meeting-store');
            const activeMeeting = await getIncidentMeeting(incident.id).catch(() => null);
            const meetingProjection =
              activeMeeting?.state === 'READY' && activeMeeting.joinUrl
                ? {
                    provider: activeMeeting.provider,
                    joinUrl: activeMeeting.joinUrl,
                    joinWebUrl: activeMeeting.joinWebUrl,
                    conferenceId: activeMeeting.conferenceId,
                    tollNumber: activeMeeting.tollNumber,
                  }
                : null;
            const card = buildMicrosoftTeamsIncidentCard(
              {
                incident: {
                  id: incident.id,
                  title: incident.title,
                  description: incident.description,
                  status: incident.status,
                  urgency: incident.urgency,
                  priority: incident.priority,
                  serviceName: incident.service.name,
                  assigneeName: incident.assignee?.name ?? null,
                  incidentUrl: `${getBaseUrl().replace(/\/+$/, '')}/incidents/${incident.id}`,
                  createdAt: incident.createdAt,
                  acknowledgedAt: incident.acknowledgedAt,
                  resolvedAt: incident.resolvedAt,
                },
                eventType,
              },
              {
                disableActions: incident.status === 'RESOLVED',
                meeting: meetingProjection,
                interactive: {
                  destinationId,
                  messageGeneration,
                  warRoomId,
                  capabilities,
                  refreshUserIds: [providerUserId],
                },
              }
            );
            addOperationalMetric('opsknight_chatops_refresh_total', 1, {
              provider: 'MICROSOFT_TEAMS',
              result: 'success',
            });
            result = teamsActionCard(card);
            break;
          }
          case 'ACKNOWLEDGE':
            await executeChatOpsCommand({
              provider: 'MICROSOFT_TEAMS',
              actor: { id: linked.userId, name: linked.displayName },
              command: { kind: 'ACKNOWLEDGE', incidentId },
              idempotency,
            });
            result = teamsActionSuccess('Incident acknowledged.');
            break;
          case 'RESOLVE':
            await executeChatOpsCommand({
              provider: 'MICROSOFT_TEAMS',
              actor: { id: linked.userId, name: linked.displayName },
              command: { kind: 'RESOLVE', incidentId, resolutionNote: actionData.resolutionNote },
              idempotency,
            });
            result = teamsActionSuccess('Incident resolved.');
            break;
          case 'ASSIGN_SELF':
            await executeChatOpsCommand({
              provider: 'MICROSOFT_TEAMS',
              actor: { id: linked.userId, name: linked.displayName },
              command: { kind: 'ASSIGN', incidentId, targetUserId: linked.userId },
              idempotency,
            });
            result = teamsActionSuccess('Incident assigned to you.');
            break;
          case 'ADD_NOTE':
            await executeChatOpsCommand({
              provider: 'MICROSOFT_TEAMS',
              actor: { id: linked.userId, name: linked.displayName },
              command: { kind: 'NOTE', incidentId, content: actionData.note! },
              idempotency,
            });
            result = teamsActionSuccess('Note added.');
            break;
          case 'SET_PRIORITY':
            await executeChatOpsCommand({
              provider: 'MICROSOFT_TEAMS',
              actor: { id: linked.userId, name: linked.displayName },
              command: { kind: 'SET_PRIORITY', incidentId, priority: actionData.priority! },
              idempotency,
            });
            result = teamsActionSuccess(`Priority changed to ${actionData.priority}.`);
            break;
          case 'SNOOZE':
            await executeChatOpsCommand({
              provider: 'MICROSOFT_TEAMS',
              actor: { id: linked.userId, name: linked.displayName },
              command: {
                kind: 'SNOOZE',
                incidentId,
                snoozedUntil: new Date(String(persistedPayload.snoozedUntil)),
                snoozeReason: actionData.reason,
              },
              idempotency,
            });
            result = teamsActionSuccess(`Incident snoozed for ${actionData.minutes} minutes.`);
            break;
          case 'ESCALATE':
            await executeChatOpsCommand({
              provider: 'MICROSOFT_TEAMS',
              actor: { id: linked.userId, name: linked.displayName },
              command: { kind: 'ESCALATE', incidentId },
              idempotency,
            });
            result = teamsActionSuccess('Escalation requested.');
            break;
          case 'JOIN_RESPONDER':
            await executeChatOpsCommand({
              provider: 'MICROSOFT_TEAMS',
              actor: { id: linked.userId, name: linked.displayName },
              command: { kind: 'JOIN_RESPONDER', incidentId },
              idempotency,
            });
            result = teamsActionSuccess('You joined as a responder.');
            break;
          case 'VIEW_RESPONDERS': {
            await executeChatOpsCommand({
              provider: 'MICROSOFT_TEAMS',
              actor: { id: linked.userId, name: linked.displayName },
              command: { kind: 'READ', incidentId },
              idempotency,
            });
            const responders = await prisma.incident.findUnique({
              where: { id: incidentId },
              select: {
                assignee: { select: { name: true } },
                watchers: { select: { user: { select: { name: true } } }, take: 20 },
              },
            });
            const names = [
              responders?.assignee?.name,
              ...(responders?.watchers.map(w => w.user.name) ?? []),
            ].filter(Boolean);
            result = teamsActionSuccess(
              names.length
                ? `Current responders: ${[...new Set(names)].join(', ')}`
                : 'No responder is currently assigned.'
            );
            break;
          }
          default:
            throw new Error(`Unhandled ChatOps kind: ${semanticKind}`);
        }
        await emitAuditEvent({
          action: `microsoftTeams.chatops.${action.action.verb.split('.').pop()}`,
          source: 'INTEGRATION',
          target: { type: 'INCIDENT', id: incidentId },
          actor: { type: 'USER', id: linked.userId },
          metadata: {
            provider: 'MICROSOFT_TEAMS',
            tenantId,
            teamId,
            channelId,
            destinationId,
            providerUserId,
            verb: action.action.verb,
            semanticKind,
            intentId,
          },
        }).catch(() => undefined);
        return result as unknown as Prisma.InputJsonValue;
      }
    );
    addOperationalMetric('opsknight_chatops_invokes_total', 1, {
      provider: 'MICROSOFT_TEAMS',
      verb: action.action.verb,
      result: 'success',
    });
    return response as unknown as TeamsInvokeResponse;
  } catch (error) {
    logger.error('[MicrosoftTeams] Adaptive Card invoke error', {
      error:
        error instanceof ZodError
          ? { name: 'ZodError', issues: error.issues }
          : error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      activityValue: input.activity.value,
    });
    addOperationalMetric('opsknight_chatops_invokes_total', 1, {
      provider: 'MICROSOFT_TEAMS',
      verb: 'unknown',
      result: 'error',
    });
    return publicError(error);
  }
}
