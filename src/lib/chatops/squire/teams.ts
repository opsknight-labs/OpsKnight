import 'server-only';
import prisma from '@/lib/prisma';
import { normalizeTrustedMicrosoftTeamsServiceUrl } from '@/lib/microsoft-teams/service-url';
import { resolveMicrosoftTeamsUser } from '@/lib/microsoft-teams/identity';
import { replyToMicrosoftTeamsActivity } from '@/lib/microsoft-teams/client';
import {
  teamsActionError,
  teamsActionSuccess,
  type TeamsInvokeResponse,
} from '@/lib/microsoft-teams/invoke-response';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import {
  answerChatQuestion,
  chatBaseUrl,
  confirmChatProposal,
  isSquireChatOpsEnabled,
} from './handler';
import { parseTeamsSquireAction, questionFromMention, renderTeamsAnswer } from './render';

/**
 * Microsoft Teams transport for Squire: an @mention of the bot in an incident war-room channel, and the
 * Confirm action on its suggestion cards. Activities arrive JWT-verified (route); mentions are queued in
 * the durable ChatOps intent pipeline and answered by the worker, confirmations are answered inline.
 */

export type TeamsSquireActivity = {
  id?: string;
  text?: string;
  serviceUrl?: string;
  from?: { id?: string; aadObjectId?: string; name?: string };
  recipient?: { id?: string };
  entities?: Array<{ type?: string; mentioned?: { id?: string } } | null>;
  conversation?: { id?: string };
  channelData?: {
    tenant?: { id?: string };
    team?: { id?: string; aadGroupId?: string };
    channel?: { id?: string };
  };
  value?: unknown;
};

/** The queued payload of a mention. Identifiers only; the question text is encrypted with it. */
export interface TeamsSquireMentionPayload {
  __kind: 'SQUIRE_MENTION';
  tenantId: string;
  serviceUrl: string;
  conversationId: string;
  activityId: string;
  channelIds: string[];
  fromId: string;
  aadObjectId: string | null;
  fromName: string | null;
  text: string;
}

export interface TeamsSquireReply {
  card: Record<string, unknown>;
}

/** True when the message @mentions the bot that received it. */
export function mentionsBot(activity: TeamsSquireActivity): boolean {
  const botId = activity.recipient?.id?.trim();
  if (!botId || !Array.isArray(activity.entities)) return false;
  return activity.entities.some(
    entity => entity?.type === 'mention' && entity.mentioned?.id?.trim() === botId
  );
}

const channelCandidates = (activity: TeamsSquireActivity) => [
  ...new Set(
    [
      activity.channelData?.channel?.id?.trim(),
      activity.conversation?.id?.split(';')[0]?.trim(),
    ].filter((value): value is string => Boolean(value))
  ),
];

/** Route: queue a mention for the worker. Returns false when the activity cannot be answered. */
export async function enqueueTeamsSquireMention(
  activity: TeamsSquireActivity,
  verifiedTenantId: string
): Promise<boolean> {
  const serviceUrl = normalizeTrustedMicrosoftTeamsServiceUrl(activity.serviceUrl ?? '');
  const activityId = activity.id?.trim();
  const conversationId = activity.conversation?.id?.trim();
  const fromId = activity.from?.id?.trim();
  const channelIds = channelCandidates(activity);
  if (!serviceUrl || !activityId || !conversationId || !fromId || channelIds.length === 0)
    return false;
  // With channel-message permissions the bot sees every message; answer only an explicit @mention.
  if (!mentionsBot(activity)) return false;
  if (!(await isSquireChatOpsEnabled())) return false;
  const payload: TeamsSquireMentionPayload = {
    __kind: 'SQUIRE_MENTION',
    tenantId: verifiedTenantId,
    serviceUrl,
    conversationId: conversationId.slice(0, 512),
    activityId: activityId.slice(0, 256),
    channelIds,
    fromId: fromId.slice(0, 256),
    aadObjectId: activity.from?.aadObjectId?.trim() || null,
    fromName: activity.from?.name?.trim().slice(0, 128) || null,
    text: (activity.text ?? '').slice(0, 4_000),
  };
  await enqueueChatOpsIntent({
    provider: 'MICROSOFT_TEAMS',
    kind: 'SLASH_COMMAND',
    // Teams redelivers an activity with the same id; the intent is then a duplicate, not a second answer.
    signature: `squire-mention:${verifiedTenantId}:${activityId}`,
    workspaceId: verifiedTenantId,
    channelId: channelIds[0],
    providerUserId: payload.fromId,
    providerTenantId: verifiedTenantId,
    providerConversationId: payload.conversationId,
    providerActivityId: payload.activityId,
    responseMode: 'DEFERRED',
    payload: { ...payload },
  });
  return true;
}

/** The incident whose Teams war room is this channel, if any. */
export async function findTeamsWarRoomIncident(tenantId: string, channelIds: readonly string[]) {
  if (!tenantId || channelIds.length === 0) return null;
  const room = await prisma.incidentWarRoom.findFirst({
    where: {
      provider: 'MICROSOFT_TEAMS',
      providerTenantId: tenantId,
      providerChannelId: { in: [...channelIds] },
      state: { in: ['READY', 'PROVISIONING'] },
    },
    select: { incidentId: true },
    orderBy: { createdAt: 'desc' },
  });
  return room?.incidentId ?? null;
}

const NOT_A_WAR_ROOM =
  'I answer in OpsKnight incident war rooms. Open the incident in OpsKnight to ask about anything else.';

async function resolveTeamsUser(input: {
  tenantId: string;
  fromId: string;
  aadObjectId: string | null;
  fromName: string | null;
}) {
  try {
    return await resolveMicrosoftTeamsUser({
      tenantId: input.tenantId,
      providerUserId: input.fromId,
      aadObjectId: input.aadObjectId,
      displayName: input.fromName,
    });
  } catch {
    // A conflicting link is treated as no link: never answer as a guessed account.
    return null;
  }
}

/** Worker: answers one mention and returns the card to reply with. */
export async function answerTeamsSquireMention(
  payload: TeamsSquireMentionPayload
): Promise<TeamsSquireReply> {
  const baseUrl = chatBaseUrl();
  const incidentId = await findTeamsWarRoomIncident(payload.tenantId, payload.channelIds);
  if (!incidentId)
    return {
      card: renderTeamsAnswer(
        {
          name: 'Squire',
          mode: 'basic',
          text: '',
          notices: [],
          citations: [],
          proposals: [],
          error: NOT_A_WAR_ROOM,
        },
        { baseUrl, ownerUserId: '' }
      ),
    };
  const user = await resolveTeamsUser(payload);
  const answer = await answerChatQuestion({
    provider: 'MICROSOFT_TEAMS',
    userId: user?.userId ?? null,
    question: questionFromMention(payload.text),
    incidentId,
  });
  return { card: renderTeamsAnswer(answer, { baseUrl, ownerUserId: user?.userId ?? '' }) };
}

/** Worker: posts the stored card in the thread. A failure is retried by the intent pipeline. */
export async function deliverTeamsSquireReply(
  payload: TeamsSquireMentionPayload,
  reply: TeamsSquireReply
): Promise<void> {
  const result = await replyToMicrosoftTeamsActivity({
    tenantId: payload.tenantId,
    serviceUrl: payload.serviceUrl,
    conversationId: payload.conversationId,
    replyToId: payload.activityId,
    card: reply.card,
  });
  if (!result.success) throw new Error(result.error);
}

/**
 * Route (inline invoke): a Confirm click on a Squire card. The result is the executor's own message,
 * returned only after its receipt; anyone but the person the suggestion was made for is refused.
 */
export async function handleTeamsSquireConfirm(input: {
  activity: TeamsSquireActivity;
  verifiedTenantId: string;
}): Promise<TeamsInvokeResponse> {
  const parsed = parseTeamsSquireAction(input.activity.value);
  if (!parsed) return teamsActionError(400, 'InvalidAction', 'This suggestion is no longer valid.');
  const fromId = input.activity.from?.id?.trim();
  if (!fromId) return teamsActionError(400, 'InvalidContext', 'Teams did not identify you.');
  const user = await resolveTeamsUser({
    tenantId: input.verifiedTenantId,
    fromId,
    aadObjectId: input.activity.from?.aadObjectId?.trim() || null,
    fromName: input.activity.from?.name?.trim() || null,
  });
  const result = await confirmChatProposal({
    provider: 'MICROSOFT_TEAMS',
    userId: user?.userId ?? null,
    actorName: user?.displayName ?? 'Teams user',
    token: parsed.token,
    owner: parsed.owner,
  });
  if (!result.ok)
    return teamsActionError(
      result.denied ? 403 : 409,
      result.denied ? 'ActionDenied' : 'NotApplied',
      result.message
    );
  return teamsActionSuccess(result.href ? `${result.message} ${result.href}` : result.message);
}
