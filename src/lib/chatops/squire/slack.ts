import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { readSlackBotToken } from '@/app/api/slack/oauth/token-rotation';
import { checkRateLimit } from '@/lib/rate-limit';
import { getSlackBotToken } from '@/lib/slack';
import { resolveOpsKnightUser, type SlackWorkspaceRef } from '@/lib/chatops/slash-commands';
import { slackApiCall } from '@/lib/war-room/providers/slack/client';
import type { SquireRequest } from '@/lib/intelligence/squire/contract';
import {
  answerChatQuestion,
  boundChatHistory,
  chatBaseUrl,
  confirmChatProposal,
  progressEditor,
  recalledPlaceholder,
  rememberPlaceholder,
  SQUIRE_CHAT_CHANNEL_QUESTIONS_PER_MINUTE,
  SQUIRE_CHAT_NOT_LINKED,
  SQUIRE_CHAT_NOT_OWNER,
  SQUIRE_CHAT_QUESTIONS_PER_MINUTE,
  SQUIRE_CHAT_RATE_LIMITED,
} from './handler';
import {
  loadSquireIdentity,
  slackCanCustomizeSender,
  slackSquireBlocks,
  slackSquireSender,
  type SquireIdentity,
} from './identity';
import { SLACK_GONE } from './publish';
import {
  appLink,
  escapeSlack,
  parseSquireButtonValue,
  questionFromMention,
  renderSlackAnswer,
  slackBlocksText,
  SQUIRE_SLACK_CONFIRM_ACTION,
  SQUIRE_SLACK_DISMISS_ACTION,
} from './render';

/**
 * Slack transport for Squire: `@squire <question>` mentions in incident channels, `/incident ask
 * <question>`, and the Confirm / Dismiss buttons on its suggestions. Requests arrive signed and are queued
 * through the durable ChatOps intent pipeline before Slack is acknowledged; this module runs in the worker.
 */

/** The queued payload of an `app_mention` event. */
export interface SlackSquireMentionPayload {
  __kind: 'SQUIRE_MENTION';
  team_id: string;
  /** Enterprise Grid org of the workspace, when there is one. */
  enterprise_id?: string;
  channel_id: string;
  user_id: string;
  text: string;
  ts: string;
  thread_ts?: string;
  /** Added by the intent worker; keys the remembered progress message of a retried answer. */
  __opsknightIntentId?: string;
}

/** What the worker stores and then posts in the thread. `__serviceId` selects the bot token only. */
export interface SlackSquireReply {
  channel: string;
  thread_ts: string;
  text: string;
  blocks: Record<string, unknown>[];
  __serviceId: string | null;
  /** The workspace the mention came from; selects that installation's token. */
  __teamId?: string;
  /** The "looking into it" message posted in the thread; the answer replaces it. */
  __placeholderTs?: string;
  /** Posts as Squire (`chat:write.customize`); used only when the answer is posted as a new message. */
  __sender?: { username?: string; icon_url?: string };
}

const thinking = (identity: SquireIdentity) =>
  `:hourglass_flowing_sand: ${escapeSlack(identity.name)} is looking into it…`;

/** A plain mrkdwn Squire message: the text, led by the Squire header when Slack shows OpsKnight as sender. */
function squireText(text: string, identity: SquireIdentity, canCustomize: boolean) {
  return {
    text,
    blocks: slackSquireBlocks(
      [{ type: 'section', text: { type: 'mrkdwn', text } }],
      identity,
      canCustomize
    ),
  };
}
/** Replies read to find the last messages of a thread (Slack returns a thread oldest first). */
const THREAD_READ_LIMIT = 200;

type SlackThreadMessage = {
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
};

/**
 * The asker's own earlier messages in the thread, oldest first, as bounded conversation history. History
 * becomes `user` turns run with the asker's access and answered in a public channel, so anyone else's words
 * (people without that access, bots relaying alert text) would be instructions the asker never gave.
 */
export function slackThreadHistory(
  messages: readonly SlackThreadMessage[],
  questionTs: string,
  askerId: string
): SquireRequest['history'] {
  return boundChatHistory(
    messages
      .filter(
        message =>
          message.ts &&
          message.ts !== questionTs &&
          !message.subtype &&
          !message.bot_id &&
          message.user === askerId
      )
      .map(message => ({ speaker: `Slack user ${askerId}`, text: message.text ?? '' }))
  );
}

async function readSlackThread(
  token: string,
  channel: string,
  threadTs: string,
  questionTs: string,
  askerId: string
): Promise<SquireRequest['history']> {
  try {
    // shortcut: reads the first THREAD_READ_LIMIT replies before the question; a longer thread loses its tail.
    const query = new URLSearchParams({
      channel,
      ts: threadTs,
      latest: questionTs,
      inclusive: 'false',
      limit: String(THREAD_READ_LIMIT),
    });
    const response = await fetch(`https://slack.com/api/conversations.replies?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      messages?: SlackThreadMessage[];
    } | null;
    return body?.ok && Array.isArray(body.messages)
      ? slackThreadHistory(body.messages, questionTs, askerId)
      : [];
  } catch {
    // History is context only; the question is still answered without it.
    return [];
  }
}

/** The channel's incident, bound to the signed workspace exactly as the /incident commands bind it. */
export async function findSlackIncidentForChannel(workspaceId: string, channelId: string) {
  if (!workspaceId || !channelId) return null;
  const select = { id: true, serviceId: true, title: true, visibility: true } as const;
  // The war-room record is canonical for channels it created (the incident's legacy slackChannelId
  // projection can lag or be missing), so a question asked in the room is always about its incident.
  const room = await prisma.incidentWarRoom
    .findFirst({
      where: {
        provider: 'SLACK',
        providerTenantId: workspaceId,
        providerChannelId: channelId,
        state: { in: ['READY', 'CLOSING', 'AMBIGUOUS'] },
      },
      select: { incident: { select } },
      orderBy: { createdAt: 'desc' },
    })
    .catch(() => null);
  if (room?.incident) return room.incident;
  return prisma.incident.findFirst({
    where: {
      slackChannelId: channelId,
      OR: [
        { slackWorkspaceId: workspaceId },
        {
          slackWorkspaceId: null,
          service: {
            OR: [{ slackWorkspaceId: workspaceId }, { slackIntegration: { workspaceId } }],
          },
        },
      ],
    },
    select,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * The bot token of the installation in this workspace. With several workspaces installed, a service's own
 * integration (or the global one) may belong to another workspace, whose token cannot read or post here.
 */
export async function slackInstallationToken(
  teamId: string,
  serviceId?: string | null
): Promise<string | null> {
  const installation = teamId
    ? await prisma.slackIntegration.findFirst({
        where: { workspaceId: teamId, enabled: true },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, botToken: true, refreshToken: true, tokenExpiresAt: true },
      })
    : null;
  if (installation?.botToken) {
    try {
      return await readSlackBotToken(installation);
    } catch {
      // Never fall back to another workspace's token for this one.
      logger.warn('[Squire] Could not read the Slack installation token');
      return null;
    }
  }
  // No installation row (environment token, single workspace): the identity check still binds the workspace.
  return getSlackBotToken(serviceId ?? undefined);
}

/** Within the per-person and per-channel question limits; checked before Squire does anything visible. */
async function withinMentionLimits(payload: SlackSquireMentionPayload): Promise<boolean> {
  const person = await checkRateLimit(
    `squire:chatops:slack-user:${payload.team_id}:${payload.user_id}`,
    SQUIRE_CHAT_QUESTIONS_PER_MINUTE,
    60_000
  );
  if (!person.allowed) return false;
  const channel = await checkRateLimit(
    `squire:chatops:slack-channel:${payload.team_id}:${payload.channel_id}`,
    SQUIRE_CHAT_CHANNEL_QUESTIONS_PER_MINUTE,
    60_000
  );
  return channel.allowed;
}

/** One private notice to the asker; repeats within ten minutes are dropped so nobody is spammed. */
async function noticeOnce(token: string, payload: SlackSquireMentionPayload, text: string) {
  const once = await checkRateLimit(
    `squire:chatops:slack-notice:${payload.team_id}:${payload.user_id}`,
    1,
    10 * 60_000
  );
  if (!once.allowed) return;
  await slackApiCall('chat.postEphemeral', token, {
    channel: payload.channel_id,
    user: payload.user_id,
    ...(payload.thread_ts ? { thread_ts: payload.thread_ts } : {}),
    text: escapeSlack(text),
  }).catch(() => undefined);
}

/**
 * Worker: answers one mention and returns the threaded reply to post, or null when nothing is posted. The
 * asker is resolved and the limits checked before any Slack call, so an unlinked or over-limit person gets a
 * single private notice and no thread activity.
 */
export async function answerSlackSquireMention(
  payload: SlackSquireMentionPayload
): Promise<SlackSquireReply | null> {
  const thread = payload.thread_ts || payload.ts;
  const workspace: SlackWorkspaceRef = {
    teamId: payload.team_id,
    enterpriseId: payload.enterprise_id || null,
  };
  const incident = await findSlackIncidentForChannel(payload.team_id, payload.channel_id);
  const botToken = await slackInstallationToken(payload.team_id, incident?.serviceId);
  if (!botToken) return null;
  const user = await resolveOpsKnightUser(payload.user_id, botToken, workspace);
  // A retried answer already passed the limits and posted its progress message.
  const remembered = await recalledPlaceholder(payload.__opsknightIntentId);
  const refusal = !user
    ? SQUIRE_CHAT_NOT_LINKED
    : !remembered && !(await withinMentionLimits(payload))
      ? SQUIRE_CHAT_RATE_LIMITED
      : null;
  if (refusal) {
    await noticeOnce(botToken, payload, refusal);
    return null;
  }
  const [identity, canCustomize] = await Promise.all([
    loadSquireIdentity(),
    slackCanCustomizeSender(incident?.serviceId),
  ]);
  const sender = slackSquireSender(identity, canCustomize);
  const reply = (text: string, blocks?: Record<string, unknown>[]): SlackSquireReply => ({
    channel: payload.channel_id,
    thread_ts: thread,
    text,
    blocks: blocks
      ? slackSquireBlocks(blocks, identity, canCustomize)
      : squireText(text, identity, canCustomize).blocks,
    __serviceId: incident?.serviceId ?? null,
    __teamId: payload.team_id,
    ...(canCustomize ? { __sender: sender } : {}),
  });
  const [history, placeholder] = await Promise.all([
    payload.thread_ts
      ? readSlackThread(
          botToken,
          payload.channel_id,
          payload.thread_ts,
          payload.ts,
          payload.user_id
        )
      : Promise.resolve([]),
    remembered ??
      slackApiCall('chat.postMessage', botToken, {
        channel: payload.channel_id,
        thread_ts: thread,
        ...squireText(thinking(identity), identity, canCustomize),
        ...sender,
      })
        .then(result => (result.ok ? (result as { ts?: string }).ts : undefined))
        .catch(() => undefined),
  ]);
  if (placeholder && !remembered)
    await rememberPlaceholder(payload.__opsknightIntentId, placeholder);
  const editor = placeholder
    ? progressEditor(text =>
        slackApiCall('chat.update', botToken, {
          channel: payload.channel_id,
          ts: placeholder,
          ...squireText(escapeSlack(text), identity, canCustomize),
        })
      )
    : null;
  const answer = await answerChatQuestion({
    provider: 'SLACK',
    userId: user!.id,
    question: questionFromMention(payload.text),
    // In a normal channel there is no incident to scope to: the question is answered as a general one,
    // still as the asker and still limited to the channel-safe read tools (the answer is public here).
    incidentId: incident?.id ?? null,
    history,
    inChannel: true,
    ...(editor ? { onProgress: (text: string) => editor.push(text) } : {}),
  });
  await editor?.settle();
  const rendered = renderSlackAnswer(answer, {
    baseUrl: chatBaseUrl(),
    ownerUserId: user!.id,
  });
  return {
    ...reply(rendered.text, rendered.blocks),
    ...(placeholder ? { __placeholderTs: placeholder } : {}),
  };
}

/** Slack refused the blocks (too long, malformed): the same message as text alone will still go through. */
const BLOCKS_REFUSED = new Set(['invalid_blocks', 'invalid_blocks_format', 'msg_too_long']);

/**
 * Worker: posts the stored reply in the thread. A failure throws so the intent pipeline retries; a new
 * message is posted only when the progress message it would replace is gone, never as a second copy.
 */
export async function deliverSlackSquireReply(reply: SlackSquireReply | null): Promise<void> {
  if (!reply) return;
  const token = reply.__teamId
    ? await slackInstallationToken(reply.__teamId, reply.__serviceId)
    : await getSlackBotToken(reply.__serviceId ?? undefined);
  if (!token) throw new Error('Slack bot token is not available');
  const {
    __serviceId: _service,
    __teamId: _team,
    __placeholderTs: placeholder,
    __sender: sender,
    ...message
  } = reply;
  const textOnly = { text: slackBlocksText(message.blocks, message.text) };
  if (placeholder) {
    const update = (content: Record<string, unknown>) =>
      slackApiCall('chat.update', token, { channel: message.channel, ts: placeholder, ...content });
    let updated = await update({ text: message.text, blocks: message.blocks });
    if (!updated.ok && BLOCKS_REFUSED.has(updated.error ?? ''))
      updated = await update({ ...textOnly, blocks: [] });
    if (updated.ok) return;
    if (!SLACK_GONE.has(updated.error ?? ''))
      throw new Error(`Slack reply update failed (${updated.error ?? 'error'})`);
  }
  const post = async (content: Record<string, unknown>) => {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...content, ...sender, unfurl_links: false, unfurl_media: false }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    return { ok: response.ok && Boolean(body?.ok), error: body?.error ?? String(response.status) };
  };
  let posted = await post(message);
  if (!posted.ok && BLOCKS_REFUSED.has(posted.error)) {
    const { blocks: _blocks, ...rest } = message;
    posted = await post({ ...rest, ...textOnly });
  }
  if (!posted.ok) throw new Error(`Slack reply failed (${posted.error})`);
}

/** `/incident ask <question>`: answered privately to the asker, in the war-room channel. */
export async function answerSlackSquireSlash(input: {
  userId: string;
  incidentId: string;
  question: string;
}): Promise<{ response_type: 'ephemeral'; text: string; blocks: Record<string, unknown>[] }> {
  const answer = await answerChatQuestion({
    provider: 'SLACK',
    userId: input.userId,
    question: input.question,
    incidentId: input.incidentId,
  });
  const rendered = renderSlackAnswer(answer, {
    baseUrl: chatBaseUrl(),
    ownerUserId: input.userId,
  });
  // An ephemeral response always shows the app as its sender, so it carries the Squire header.
  const identity = await loadSquireIdentity();
  return {
    response_type: 'ephemeral',
    text: rendered.text,
    blocks: slackSquireBlocks(rendered.blocks, identity, false),
  };
}

type SlackButtonPayload = {
  actions?: Array<{ action_id?: string; value?: string }>;
  user?: { id?: string };
  team?: { id?: string };
  enterprise?: { id?: string } | null;
  channel?: { id?: string };
  container?: { channel_id?: string; thread_ts?: string; message_ts?: string };
  message?: { ts?: string; thread_ts?: string };
};

export function isSlackSquireAction(actionId: unknown): boolean {
  return actionId === SQUIRE_SLACK_CONFIRM_ACTION || actionId === SQUIRE_SLACK_DISMISS_ACTION;
}

/**
 * Worker: a Confirm or Dismiss click. Only the person the suggestion was made for may use it, and a
 * result is posted to the channel only with the executor's receipt.
 */
export async function handleSlackSquireButton(
  payload: SlackButtonPayload
): Promise<Record<string, unknown>> {
  const action = payload.actions?.[0];
  const parsed = parseSquireButtonValue(action?.value);
  const ephemeral = (text: string) => ({
    response_type: 'ephemeral',
    replace_original: false,
    text,
  });
  if (!action || !parsed) return ephemeral('This suggestion is no longer valid. Ask Squire again.');
  const channelId = payload.channel?.id ?? payload.container?.channel_id ?? '';
  const teamId = payload.team?.id ?? '';
  const incident = await findSlackIncidentForChannel(teamId, channelId);
  const botToken = await slackInstallationToken(teamId, incident?.serviceId);
  const slackUserId = payload.user?.id ?? '';
  const user =
    botToken && slackUserId
      ? await resolveOpsKnightUser(slackUserId, botToken, {
          teamId,
          enterpriseId: payload.enterprise?.id ?? null,
        })
      : null;
  if (action.action_id === SQUIRE_SLACK_DISMISS_ACTION) {
    if (!user || user.id !== parsed.owner) return ephemeral(SQUIRE_CHAT_NOT_OWNER);
    return ephemeral('Dismissed. Nothing was changed.');
  }
  const result = await confirmChatProposal({
    provider: 'SLACK',
    userId: user?.id ?? null,
    actorName: user?.name ?? 'Slack user',
    token: parsed.token,
    owner: parsed.owner,
  });
  if (!result.ok) {
    if (!result.denied)
      logger.info('[Squire] Chat confirmation not applied', { provider: 'SLACK' });
    return ephemeral(`:warning: ${escapeSlack(result.message)}`);
  }
  const thread = payload.container?.thread_ts ?? payload.message?.thread_ts;
  const href = result.href ? appLink(result.href, chatBaseUrl()) : null;
  const link = href ? ` <${href}|Open incident>` : '';
  return {
    response_type: 'in_channel',
    replace_original: false,
    ...(thread ? { thread_ts: thread } : {}),
    text: `:white_check_mark: <@${slackUserId}> confirmed a Squire suggestion: ${escapeSlack(result.message)}${link}`,
  };
}
