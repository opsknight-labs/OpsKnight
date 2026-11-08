import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSlackBotToken } from '@/lib/slack';
import { resolveOpsKnightUser } from '@/lib/chatops/slash-commands';
import {
  answerChatQuestion,
  chatBaseUrl,
  confirmChatProposal,
  SQUIRE_CHAT_NOT_OWNER,
} from './handler';
import {
  escapeSlack,
  parseSquireButtonValue,
  questionFromMention,
  renderSlackAnswer,
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
  channel_id: string;
  user_id: string;
  text: string;
  ts: string;
  thread_ts?: string;
}

/** What the worker stores and then posts in the thread. `__serviceId` selects the bot token only. */
export interface SlackSquireReply {
  channel: string;
  thread_ts: string;
  text: string;
  blocks: Record<string, unknown>[];
  __serviceId: string | null;
}

/** The channel's incident, bound to the signed workspace exactly as the /incident commands bind it. */
export async function findSlackIncidentForChannel(workspaceId: string, channelId: string) {
  if (!workspaceId || !channelId) return null;
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
    select: { id: true, serviceId: true, title: true },
    orderBy: { createdAt: 'desc' },
  });
}

const NOT_AN_INCIDENT_CHANNEL =
  'I answer in OpsKnight incident channels. Open the incident in OpsKnight to ask about anything else.';

/** Worker: answers one mention and returns the threaded reply to post. */
export async function answerSlackSquireMention(
  payload: SlackSquireMentionPayload
): Promise<SlackSquireReply> {
  const thread = payload.thread_ts || payload.ts;
  const incident = await findSlackIncidentForChannel(payload.team_id, payload.channel_id);
  const reply = (text: string, blocks?: Record<string, unknown>[]): SlackSquireReply => ({
    channel: payload.channel_id,
    thread_ts: thread,
    text,
    blocks: blocks ?? [{ type: 'section', text: { type: 'mrkdwn', text } }],
    __serviceId: incident?.serviceId ?? null,
  });
  if (!incident) return reply(NOT_AN_INCIDENT_CHANNEL);
  const botToken = await getSlackBotToken(incident.serviceId);
  const user = botToken ? await resolveOpsKnightUser(payload.user_id, botToken) : null;
  const answer = await answerChatQuestion({
    provider: 'SLACK',
    userId: user?.id ?? null,
    question: questionFromMention(payload.text),
    incidentId: incident.id,
  });
  const rendered = renderSlackAnswer(answer, {
    baseUrl: chatBaseUrl(),
    ownerUserId: user?.id ?? '',
  });
  return reply(rendered.text, rendered.blocks);
}

/** Worker: posts the stored reply in the thread. A failure is retried by the intent pipeline. */
export async function deliverSlackSquireReply(reply: SlackSquireReply): Promise<void> {
  const token = await getSlackBotToken(reply.__serviceId ?? undefined);
  if (!token) throw new Error('Slack bot token is not available');
  const { __serviceId: _service, ...message } = reply;
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...message, unfurl_links: false, unfurl_media: false }),
    signal: AbortSignal.timeout(5_000),
  });
  const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !body?.ok)
    throw new Error(`Slack reply failed (${body?.error ?? response.status})`);
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
  return { response_type: 'ephemeral', ...rendered };
}

type SlackButtonPayload = {
  actions?: Array<{ action_id?: string; value?: string }>;
  user?: { id?: string };
  team?: { id?: string };
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
  const incident = await findSlackIncidentForChannel(payload.team?.id ?? '', channelId);
  const botToken = await getSlackBotToken(incident?.serviceId ?? undefined);
  const slackUserId = payload.user?.id ?? '';
  const user = botToken && slackUserId ? await resolveOpsKnightUser(slackUserId, botToken) : null;
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
  const link = result.href ? ` <${result.href}|Open incident>` : '';
  return {
    response_type: 'in_channel',
    replace_original: false,
    ...(thread ? { thread_ts: thread } : {}),
    text: `:white_check_mark: <@${slackUserId}> confirmed a Squire suggestion: ${escapeSlack(result.message)}${link}`,
  };
}
