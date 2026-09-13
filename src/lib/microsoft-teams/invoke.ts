import 'server-only';

import type { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import prisma from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { getBaseUrl } from '@/lib/env-validation';
import { normalizeError, toPublicAppError } from '@/lib/errors';
import { emitAuditEvent } from '@/lib/audit';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { enqueueChatOpsIntent, processInlineChatOpsIntent } from '@/lib/chatops/intents';
import { executeChatOpsCommand } from '@/lib/chatops/commands';
import { getIncidentChatOpsCapabilities } from '@/lib/chatops/incident-capabilities';
import { buildMicrosoftTeamsIncidentCard } from './cards';
import { parseMicrosoftTeamsAction, TEAMS_CHATOPS_VERBS } from './action-schema';
import { createMicrosoftTeamsIdentityChallenge, resolveMicrosoftTeamsUser } from './identity';
import { teamsActionCard, teamsActionError, teamsActionSuccess, type TeamsInvokeResponse } from './invoke-response';

export type MicrosoftTeamsActionActivity = {
  id?: string;
  replyToId?: string;
  serviceUrl?: string;
  from?: { id?: string; aadObjectId?: string; name?: string };
  conversation?: { id?: string };
  channelData?: { tenant?: { id?: string }; team?: { id?: string }; channel?: { id?: string } };
  value?: unknown;
};

function publicError(error: unknown): TeamsInvokeResponse {
  if (error instanceof ZodError) return teamsActionError(400, 'InvalidAction', 'This Teams action is invalid or outdated.');
  const normalized = normalizeError(error);
  const exposed = toPublicAppError(normalized);
  const status = [400, 401, 403, 404, 409, 429, 503].includes(normalized.status) ? normalized.status : 500;
  const code = status === 403 ? 'ActionDenied' : exposed.code;
  return teamsActionError(status, code, exposed.message || 'OpsKnight could not apply this action.');
}

export async function handleMicrosoftTeamsAdaptiveCardAction(input: {
  activity: MicrosoftTeamsActionActivity;
  verifiedTenantId: string;
}): Promise<TeamsInvokeResponse> {
  try {
    const action = parseMicrosoftTeamsAction(input.activity.value);
    const tenantId = input.verifiedTenantId.trim();
    const teamId = input.activity.channelData?.team?.id?.trim() ?? '';
    const channelId = input.activity.channelData?.channel?.id?.trim() ?? '';
    const providerUserId = input.activity.from?.id?.trim() ?? '';
    const activityId = input.activity.id?.trim() ?? '';
    if (!tenantId || !teamId || !channelId || !providerUserId || !activityId) {
      return teamsActionError(400, 'InvalidContext', 'Teams did not provide the required action context.');
    }

    const { incidentId, destinationId, messageGeneration } = action.data;
    const isRefresh = action.action.verb === TEAMS_CHATOPS_VERBS.REFRESH;
    const limit = await checkRateLimit(`chatops:teams:${isRefresh ? 'refresh' : 'mutation'}:${tenantId}:${providerUserId}`, isRefresh ? 120 : 30, 60_000);
    if (!limit.allowed) return teamsActionError(429, 'RateLimited', 'Too many Teams actions. Please retry shortly.');
    const [config, destination, incident, canonical] = await Promise.all([
      prisma.microsoftTeamsConfig.findFirst({ where: { enabled: true, interactiveEnabled: true }, orderBy: { updatedAt: 'desc' } }),
      prisma.microsoftTeamsDestination.findUnique({ where: { id: destinationId }, include: { installation: true } }),
      prisma.incident.findUnique({ where: { id: incidentId }, include: { service: { select: { name: true } }, assignee: { select: { name: true } } } }),
      prisma.microsoftTeamsIncidentMessage.findUnique({ where: { incidentId_destinationId: { incidentId, destinationId } } }),
    ]);
    if (!config || !destination?.enabled || !destination.interactiveEnabled || !destination.installation?.enabled) {
      return teamsActionError(403, 'InteractiveDisabled', 'Microsoft Teams interactive actions are currently disabled.');
    }
    const routeMatches = destination.tenantId === tenantId && destination.teamId === teamId
      && destination.channelId === channelId && incident?.serviceId === destination.serviceId;
    const messageMatches = canonical && canonical.messageGeneration === messageGeneration
      && (!input.activity.conversation?.id || canonical.conversationId === input.activity.conversation.id)
      && (!input.activity.replyToId || canonical.messageId === input.activity.replyToId);
    if (!routeMatches || !messageMatches) {
      return teamsActionError(409, 'StaleCard', 'This Teams card is no longer the active destination for this incident.');
    }

    const identityInput = {
      tenantId, providerUserId,
      aadObjectId: input.activity.from?.aadObjectId?.trim() || null,
      displayName: input.activity.from?.name?.trim() || null,
    };
    const linked = await resolveMicrosoftTeamsUser(identityInput);
    addOperationalMetric('opsknight_chatops_identity_resolution_total', 1, { provider: 'MICROSOFT_TEAMS', result: linked ? 'linked' : 'unlinked' });
    if (!linked) {
      const token = await createMicrosoftTeamsIdentityChallenge(identityInput);
      const url = `${getBaseUrl().replace(/\/+$/, '')}/settings/chatops/link?token=${encodeURIComponent(token)}`;
      return teamsActionError(401, 'AccountLinkRequired', `Link your OpsKnight account, then retry this action: ${url}`);
    }

    const signature = `${tenantId}:${activityId}`;
    // Intent payload is the retry contract. Convert relative user input to an
    // absolute deadline once, before it is encrypted and durably replayed.
    const snoozedUntil = action.action.verb === TEAMS_CHATOPS_VERBS.SNOOZE
      ? new Date(Date.now() + (action.data as unknown as { minutes: number }).minutes * 60_000).toISOString()
      : undefined;
    const payload = { action, tenantId, teamId, channelId, providerUserId, userId: linked.userId, ...(snoozedUntil ? { snoozedUntil } : {}) };
    const intent = await enqueueChatOpsIntent({
      provider: 'MICROSOFT_TEAMS', kind: 'INTERACTIVE_ACTION', signature,
      workspaceId: tenantId, channelId, providerUserId, payload, responseMode: 'INLINE',
      providerTenantId: tenantId, providerConversationId: input.activity.conversation?.id,
      providerChannelId: channelId, providerActivityId: activityId,
      providerObjectId: identityInput.aadObjectId ?? undefined,
    });
    if (intent.duplicate) addOperationalMetric('opsknight_chatops_duplicate_total', 1, { provider: 'MICROSOFT_TEAMS', verb: action.action.verb });

    const response = await processInlineChatOpsIntent(intent.id, async ({ intentId, payload: persistedPayload }) => {
      const idempotency = { key: intentId, principalId: `chatops:microsoft-teams:${tenantId}:${providerUserId}` };
      const actionData = action.data as typeof action.data & { resolutionNote?: string; note?: string; priority?: string; minutes?: number; reason?: string };
      let result: TeamsInvokeResponse;
      switch (action.action.verb) {
        case TEAMS_CHATOPS_VERBS.REFRESH: {
          const capabilities = await getIncidentChatOpsCapabilities({ incidentId, userId: linked.userId });
          const eventType = incident.status === 'RESOLVED' ? 'resolved' : incident.acknowledgedAt ? 'acknowledged' : 'triggered';
          const card = buildMicrosoftTeamsIncidentCard({
            incident: {
              id: incident.id, title: incident.title, description: incident.description,
              status: incident.status, urgency: incident.urgency, priority: incident.priority,
              serviceName: incident.service.name, assigneeName: incident.assignee?.name ?? null,
              incidentUrl: `${getBaseUrl().replace(/\/+$/, '')}/incidents/${incident.id}`,
              createdAt: incident.createdAt, acknowledgedAt: incident.acknowledgedAt, resolvedAt: incident.resolvedAt,
            }, eventType,
          }, { disableActions: incident.status === 'RESOLVED', interactive: { destinationId, messageGeneration, capabilities, refreshUserIds: [providerUserId] } });
          result = teamsActionCard(card);
          break;
        }
        case TEAMS_CHATOPS_VERBS.ACK:
          await executeChatOpsCommand({ provider: 'MICROSOFT_TEAMS', actor: { id: linked.userId, name: linked.displayName }, command: { kind: 'ACKNOWLEDGE', incidentId }, idempotency });
          result = teamsActionSuccess('Incident acknowledged.'); break;
        case TEAMS_CHATOPS_VERBS.RESOLVE:
          await executeChatOpsCommand({ provider: 'MICROSOFT_TEAMS', actor: { id: linked.userId, name: linked.displayName }, command: { kind: 'RESOLVE', incidentId, resolutionNote: actionData.resolutionNote }, idempotency });
          result = teamsActionSuccess('Incident resolved.'); break;
        case TEAMS_CHATOPS_VERBS.ASSIGN_SELF:
          await executeChatOpsCommand({ provider: 'MICROSOFT_TEAMS', actor: { id: linked.userId, name: linked.displayName }, command: { kind: 'ASSIGN', incidentId, targetUserId: linked.userId }, idempotency });
          result = teamsActionSuccess('Incident assigned to you.'); break;
        case TEAMS_CHATOPS_VERBS.NOTE:
          await executeChatOpsCommand({ provider: 'MICROSOFT_TEAMS', actor: { id: linked.userId, name: linked.displayName }, command: { kind: 'NOTE', incidentId, content: actionData.note! }, idempotency });
          result = teamsActionSuccess('Note added.'); break;
        case TEAMS_CHATOPS_VERBS.PRIORITY:
          await executeChatOpsCommand({ provider: 'MICROSOFT_TEAMS', actor: { id: linked.userId, name: linked.displayName }, command: { kind: 'SET_PRIORITY', incidentId, priority: actionData.priority! }, idempotency });
          result = teamsActionSuccess(`Priority changed to ${actionData.priority}.`); break;
        case TEAMS_CHATOPS_VERBS.SNOOZE:
          await executeChatOpsCommand({ provider: 'MICROSOFT_TEAMS', actor: { id: linked.userId, name: linked.displayName }, command: { kind: 'SNOOZE', incidentId, snoozedUntil: new Date(String(persistedPayload.snoozedUntil)), snoozeReason: actionData.reason }, idempotency });
          result = teamsActionSuccess(`Incident snoozed for ${actionData.minutes} minutes.`); break;
        case TEAMS_CHATOPS_VERBS.ESCALATE:
          await executeChatOpsCommand({ provider: 'MICROSOFT_TEAMS', actor: { id: linked.userId, name: linked.displayName }, command: { kind: 'ESCALATE', incidentId }, idempotency });
          result = teamsActionSuccess('Escalation requested.'); break;
        case TEAMS_CHATOPS_VERBS.JOIN_RESPONDER:
          await executeChatOpsCommand({ provider: 'MICROSOFT_TEAMS', actor: { id: linked.userId, name: linked.displayName }, command: { kind: 'JOIN_RESPONDER', incidentId }, idempotency });
          result = teamsActionSuccess('You joined as a responder.'); break;
        case TEAMS_CHATOPS_VERBS.WHO: {
          await executeChatOpsCommand({ provider: 'MICROSOFT_TEAMS', actor: { id: linked.userId, name: linked.displayName }, command: { kind: 'READ', incidentId }, idempotency });
          const responders = await prisma.incident.findUnique({ where: { id: incidentId }, select: { assignee: { select: { name: true } }, watchers: { select: { user: { select: { name: true } } }, take: 20 } } });
          const names = [responders?.assignee?.name, ...(responders?.watchers.map(w => w.user.name) ?? [])].filter(Boolean);
          result = teamsActionSuccess(names.length ? `Current responders: ${[...new Set(names)].join(', ')}` : 'No responder is currently assigned.'); break;
        }
      }
      await emitAuditEvent({
        action: `microsoftTeams.chatops.${action.action.verb.split('.').pop()}`,
        source: 'INTEGRATION', target: { type: 'INCIDENT', id: incidentId },
        actor: { type: 'USER', id: linked.userId },
        metadata: { provider: 'MICROSOFT_TEAMS', tenantId, teamId, channelId, destinationId, providerUserId, verb: action.action.verb, intentId },
      }).catch(() => undefined);
      return result as unknown as Prisma.InputJsonValue;
    });
    addOperationalMetric('opsknight_chatops_invokes_total', 1, { provider: 'MICROSOFT_TEAMS', verb: action.action.verb, result: 'success' });
    return response as unknown as TeamsInvokeResponse;
  } catch (error) {
    addOperationalMetric('opsknight_chatops_invokes_total', 1, { provider: 'MICROSOFT_TEAMS', verb: 'unknown', result: 'error' });
    return publicError(error);
  }
}
