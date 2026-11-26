import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { normalizeTrustedMicrosoftTeamsServiceUrl } from '@/lib/microsoft-teams/service-url';
import { resolveMicrosoftTeamsUser } from '@/lib/microsoft-teams/identity';
import {
  replyToMicrosoftTeamsActivity,
  updateMicrosoftTeamsChannelCard,
} from '@/lib/microsoft-teams/client';
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
  progressEditor,
  recalledPlaceholder,
  rememberPlaceholder,
} from './handler';
import { loadSquireIdentity, withTeamsSquireHeader, type SquireIdentity } from './identity';
import {
  appLink,
  markdownToTeams,
  parseTeamsSquireAction,
  questionFromMention,
  renderTeamsAnswer,
} from './render';

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
  /** Added by the intent worker; keys the remembered progress message of a retried answer. */
  __opsknightIntentId?: string;
}

export interface TeamsSquireReply {
  card: Record<string, unknown>;
  /** The "looking into it" reply posted while answering; the answer replaces it. */
  placeholderId?: string;
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
  if (!(await isSquireChatOpsEnabled())) {
    // Say so instead of silently dropping the mention (the asker would otherwise wait forever).
    logger.info('[Squire] Teams mention ignored: Squire is turned off for chat', {
      tenantId: verifiedTenantId,
    });
    // Not awaited: the activity must be acknowledged promptly; the reply is best-effort.
    void (async () =>
      replyToMicrosoftTeamsActivity({
        tenantId: verifiedTenantId,
        serviceUrl,
        conversationId,
        replyToId: activityId,
        card: withTeamsSquireHeader(
          renderTeamsAnswer(
            {
              name: 'Squire',
              mode: 'basic',
              text: '',
              notices: [],
              citations: [],
              proposals: [],
              error: SQUIRE_TURNED_OFF_FOR_CHAT,
            },
            { baseUrl: chatBaseUrl(), ownerUserId: '' }
          ),
          await loadSquireIdentity()
        ),
      }))().catch(error =>
      logger.warn('[Squire] Could not tell the Teams user that Squire is off', {
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return false;
  }
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

/** The root message id of a channel thread (`19:…@thread.tacv2;messageid=123`). */
export function teamsThreadRootId(conversationId: string | null | undefined): string | null {
  const match = /;messageid=([^;]+)/i.exec(conversationId ?? '');
  return match?.[1]?.trim() || null;
}

/**
 * The incident a question is about: the channel's war room, or — in a normal notification
 * channel — the incident whose card heads the thread the bot was mentioned in.
 */
export async function findTeamsIncidentForConversation(
  tenantId: string,
  channelIds: readonly string[],
  conversationId: string | null | undefined
): Promise<string | null> {
  const warRoomIncident = await findTeamsWarRoomIncident(tenantId, channelIds);
  if (warRoomIncident) return warRoomIncident;
  const rootId = teamsThreadRootId(conversationId);
  if (!tenantId || !rootId || channelIds.length === 0) return null;
  const card = await prisma.microsoftTeamsIncidentMessage.findFirst({
    where: { messageId: rootId, tenantId, channelId: { in: [...channelIds] } },
    select: { incidentId: true },
  });
  return card?.incidentId ?? null;
}

const SQUIRE_TURNED_OFF_FOR_CHAT =
  'Squire is turned off for chat in this OpsKnight workspace. An administrator can turn it on in Settings → Intelligence → AI.';

function notAWarRoomMessage(baseUrl: string): string {
  return `I answer in OpsKnight incident war rooms and in the thread of an incident card. To ask about anything else, open [OpsKnight](${baseUrl}/incidents).`;
}

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

/** A one-line Squire card (the progress message while an answer is written). */
function teamsProgressCard(text: string, identity: SquireIdentity): Record<string, unknown> {
  return withTeamsSquireHeader(
    {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [{ type: 'TextBlock', wrap: true, text: markdownToTeams(text, chatBaseUrl()) }],
    },
    identity
  );
}

/**
 * Worker: answers one mention and returns the card to reply with. While it works, a "looking into it"
 * reply is posted and edited with progress (investigation steps, the answer so far); the answer replaces it.
 */
export async function answerTeamsSquireMention(
  payload: TeamsSquireMentionPayload
): Promise<TeamsSquireReply> {
  const baseUrl = chatBaseUrl();
  const identity = await loadSquireIdentity();
  const incidentId = await findTeamsIncidentForConversation(
    payload.tenantId,
    payload.channelIds,
    payload.conversationId
  );
  if (!incidentId)
    return {
      card: withTeamsSquireHeader(
        renderTeamsAnswer(
          {
            name: 'Squire',
            mode: 'basic',
            text: '',
            notices: [],
            citations: [],
            proposals: [],
            error: notAWarRoomMessage(baseUrl),
          },
          { baseUrl, ownerUserId: '' }
        ),
        identity
      ),
    };
  const user = await resolveTeamsUser(payload);
  // A retried answer edits the progress reply its earlier attempt posted instead of posting another.
  const remembered = user ? await recalledPlaceholder(payload.__opsknightIntentId) : null;
  const placeholder =
    remembered ??
    (user
      ? await replyToMicrosoftTeamsActivity({
          tenantId: payload.tenantId,
          serviceUrl: payload.serviceUrl,
          conversationId: payload.conversationId,
          replyToId: payload.activityId,
          card: teamsProgressCard(`${identity.name} is looking into it…`, identity),
        })
          .then(result => (result.success ? result.providerMessageId : undefined))
          .catch(() => undefined)
      : undefined);
  if (placeholder && !remembered)
    await rememberPlaceholder(payload.__opsknightIntentId, placeholder);
  const editor = placeholder
    ? progressEditor(text =>
        updateMicrosoftTeamsChannelCard({
          tenantId: payload.tenantId,
          channelId: payload.channelIds[0],
          conversationId: payload.conversationId,
          messageId: placeholder,
          serviceUrl: payload.serviceUrl,
          incidentId,
          card: teamsProgressCard(text, identity),
        })
      )
    : null;
  const answer = await answerChatQuestion({
    provider: 'MICROSOFT_TEAMS',
    userId: user?.userId ?? null,
    question: questionFromMention(payload.text),
    incidentId,
    inChannel: true,
    ...(editor ? { onProgress: (text: string) => editor.push(text) } : {}),
  });
  await editor?.settle();
  return {
    card: withTeamsSquireHeader(
      renderTeamsAnswer(answer, { baseUrl, ownerUserId: user?.userId ?? '' }),
      identity
    ),
    ...(placeholder ? { placeholderId: placeholder } : {}),
  };
}

/**
 * Worker: posts the stored card in the thread. A failure throws so the intent pipeline retries; a new reply
 * is posted only when the progress reply it would replace is gone, never as a second copy.
 */
export async function deliverTeamsSquireReply(
  payload: TeamsSquireMentionPayload,
  reply: TeamsSquireReply
): Promise<void> {
  if (reply.placeholderId) {
    const updated = await updateMicrosoftTeamsChannelCard({
      tenantId: payload.tenantId,
      channelId: payload.channelIds[0] ?? '',
      conversationId: payload.conversationId,
      messageId: reply.placeholderId,
      serviceUrl: payload.serviceUrl,
      incidentId: '',
      card: reply.card,
    });
    if (updated.success) return;
    if (updated.errorCode !== 'MESSAGE_NOT_FOUND')
      throw new Error(`Teams reply update failed (${updated.errorCode ?? updated.error})`);
  }
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
  // Always an absolute link: a relative path is not clickable in Teams.
  const href = result.href ? appLink(result.href, chatBaseUrl()) : null;
  return teamsActionSuccess(href ? `${result.message} ${href}` : result.message);
}
