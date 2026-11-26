import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSlackBotToken } from '@/lib/slack';
import { retryFetch } from '@/lib/retry';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import { trustedSlackEmail } from '@/lib/chatops/slash-commands';

/**
 * 📌 reaction sync: a pin emoji on a war-room message saves it as an incident note. The events route only
 * validates and queues (Slack wants an answer within three seconds, and the Slack reads below can wait on
 * Retry-After); the durable intent worker does the rest. Re-reacting, a second reactor or a Slack
 * redelivery never duplicates the note: the intent is keyed by event id and the note by message.
 */

export const PIN_EMOJIS = new Set([
  'pushpin',
  'round_pushpin',
  'memo',
  'star',
  'bookmark',
  'pin',
  'push_pin',
  'note',
]);

export interface SlackReactionPinPayload {
  __kind: 'REACTION_PIN';
  team_id: string;
  enterprise_id?: string;
  channel_id: string;
  message_ts: string;
  user_id: string;
}

const str = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** The queued payload of a pin-emoji `reaction_added` event, or null for any other event. */
export function slackReactionPinPayload(envelope: {
  team_id?: unknown;
  enterprise_id?: unknown;
  event?: { type?: unknown; reaction?: unknown; user?: unknown; team_id?: unknown; item?: unknown };
}): SlackReactionPinPayload | null {
  const event = envelope.event;
  if (!event || event.type !== 'reaction_added') return null;
  const emoji = str(event.reaction, 100).split('::')[0];
  if (!PIN_EMOJIS.has(emoji)) return null;
  const item = (event.item ?? {}) as { channel?: unknown; ts?: unknown };
  const payload: SlackReactionPinPayload = {
    __kind: 'REACTION_PIN',
    team_id: str(envelope.team_id, 64) || str(event.team_id, 64),
    channel_id: str(item.channel, 64),
    message_ts: str(item.ts, 64),
    user_id: str(event.user, 64),
  };
  const enterpriseId = str(envelope.enterprise_id, 64);
  if (enterpriseId) payload.enterprise_id = enterpriseId;
  if (!payload.team_id || !payload.channel_id || !payload.message_ts || !payload.user_id)
    return null;
  return payload;
}

/** Route side: queue the pin; true when queued (or already queued for this event). */
export async function enqueueSlackReactionPin(
  envelope: Parameters<typeof slackReactionPinPayload>[0] & { event_id?: unknown }
): Promise<boolean> {
  const payload = slackReactionPinPayload(envelope);
  if (!payload) return false;
  const eventId =
    str(envelope.event_id, 128) || `${payload.channel_id}:${payload.message_ts}:${payload.user_id}`;
  await enqueueChatOpsIntent({
    provider: 'SLACK',
    kind: 'SLASH_COMMAND',
    signature: `reaction-pin:${payload.team_id}:${eventId}`,
    workspaceId: payload.team_id,
    channelId: payload.channel_id,
    slackUserId: payload.user_id,
    responseMode: 'DEFERRED',
    payload: { ...payload },
  });
  return true;
}

type SlackMessage = { ts: string; text?: string };

async function slackGet(url: string, botToken: string) {
  const response = await retryFetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
  return response.json();
}

/** Worker: saves the reacted message as an incident note. Returns null (there is no response_url). */
export async function processSlackReactionPin(payload: SlackReactionPinPayload): Promise<null> {
  const { team_id: workspaceId, channel_id: channelId, message_ts: messageTs } = payload;
  // Channel IDs are not an authorization boundary. Bind the event to the workspace installation,
  // while retaining legacy rows that predate the explicit Incident.slackWorkspaceId field.
  const incident = await prisma.incident.findFirst({
    where: {
      AND: [
        { slackChannelId: channelId },
        {
          OR: [
            { slackWorkspaceId: workspaceId },
            { slackWorkspaceId: null, service: { slackIntegration: { workspaceId } } },
          ],
        },
      ],
    },
    select: { id: true, serviceId: true },
  });
  if (!incident) return null;

  const alreadyPinned = await prisma.slackPinnedMessage.findUnique({
    where: { workspaceId_channelId_messageTs: { workspaceId, channelId, messageTs } },
    select: { id: true },
  });
  if (alreadyPinned) return null;

  const botToken = await getSlackBotToken(incident.serviceId);
  if (!botToken) return null;

  let messageText = '';
  let lookupError: string | undefined;
  try {
    const history = await slackGet(
      `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&latest=${encodeURIComponent(messageTs)}&inclusive=true&limit=10`,
      botToken
    );
    if (!history.ok) lookupError = history.error || 'unknown_error';
    // Exact match only: a thread reply is not in channel history, and the latest top-level
    // message must never be saved in its place.
    const found = history.ok
      ? (history.messages as SlackMessage[] | undefined)?.find(m => m.ts === messageTs)
      : null;
    if (found?.text) messageText = found.text;
    else {
      const replies = await slackGet(
        `https://slack.com/api/conversations.replies?channel=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(messageTs)}&oldest=${encodeURIComponent(messageTs)}&latest=${encodeURIComponent(messageTs)}&inclusive=true&limit=5`,
        botToken
      );
      if (!replies.ok) lookupError = lookupError || replies.error || 'unknown_error';
      const reply = replies.ok
        ? (replies.messages as SlackMessage[] | undefined)?.find(m => m.ts === messageTs)
        : null;
      if (reply?.text) messageText = reply.text;
    }
  } catch (error) {
    lookupError = error instanceof Error ? error.message : String(error);
  }
  if (!messageText) {
    if (lookupError) {
      logger.warn('[Slack Events] Could not read pinned message text', {
        incidentId: incident.id,
        channelId,
        messageTs,
        error: lookupError,
        hint:
          lookupError === 'missing_scope'
            ? "Slack app is missing the 'channels:history' (or 'groups:history' for private channels) scope. Re-authorize Slack in Settings > Slack."
            : undefined,
      });
    }
    messageText =
      lookupError === 'missing_scope'
        ? "(message text unavailable — Slack app is missing the 'channels:history' scope; re-authorize Slack in Settings > Slack)"
        : lookupError
          ? `(message text unavailable — Slack API error: ${lookupError})`
          : 'Pinned message from Slack war-room channel';
  }

  let authorName = 'Slack User';
  let reactorEmail: string | undefined;
  try {
    const userData = await slackGet(
      `https://slack.com/api/users.info?user=${encodeURIComponent(payload.user_id)}`,
      botToken
    );
    if (userData.ok && userData.user) {
      authorName = userData.user.profile?.real_name || userData.user.name || payload.user_id;
      // Same trust rule as every other Slack action: only a full, active member of the signed
      // workspace (or its Grid org) with a confirmed email is attributed to an OpsKnight account.
      reactorEmail = trustedSlackEmail(userData.user, {
        teamId: workspaceId,
        enterpriseId: payload.enterprise_id || null,
      });
    }
  } catch (error) {
    logger.warn('[Slack Events] Failed to fetch reactor info', {
      error: error instanceof Error ? error.name : 'error',
    });
  }

  const resolvedUser = reactorEmail
    ? await prisma.user.findFirst({
        where: { email: { equals: reactorEmail, mode: 'insensitive' }, status: 'ACTIVE' },
        select: { id: true },
      })
    : null;
  const noteUserId = resolvedUser?.id ?? null;
  const actorLabel = noteUserId ? authorName : `${authorName} (external Slack user)`;

  let created: boolean;
  try {
    created = await prisma.$transaction(async tx => {
      const existingClaim = await tx.slackPinnedMessage.findUnique({
        where: { workspaceId_channelId_messageTs: { workspaceId, channelId, messageTs } },
      });
      if (existingClaim) return false;
      await tx.slackPinnedMessage.create({
        data: { incidentId: incident.id, workspaceId, channelId, messageTs, pinnedBy: authorName },
      });
      await tx.incidentNote.create({
        data: {
          incidentId: incident.id,
          userId: noteUserId,
          content: `📌 [Slack Pin by ${actorLabel}]: ${messageText}`,
        },
      });
      await tx.incidentEvent.create({
        data: {
          incidentId: incident.id,
          type: 'COMMENT',
          message: `Note added via Slack pin by ${actorLabel}`,
        },
      });
      return true;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return null;
    throw error;
  }
  if (!created) return null;

  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botToken}` },
    body: JSON.stringify({
      channel: channelId,
      thread_ts: messageTs,
      text: '📌 *Saved to OpsKnight incident notes.*',
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  logger.info('[Slack Events] Pinned message saved as incident note', { incidentId: incident.id });
  return null;
}
