import 'server-only';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import { logger } from '@/lib/logger';
import { isSquireChatOpsEnabled } from './handler';
import { loadSquireIdentity } from './identity';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  findSlackIncidentForChannel,
  slackInstallationToken,
  type SlackSquireMentionPayload,
} from './slack';

type SlackEventEnvelope = {
  team_id?: unknown;
  enterprise_id?: unknown;
  event_id?: unknown;
  /** Who the event was delivered for; the bot's entry names its own user id. */
  authorizations?: unknown;
  event?: {
    type?: unknown;
    subtype?: unknown;
    user?: unknown;
    bot_id?: unknown;
    text?: unknown;
    channel?: unknown;
    ts?: unknown;
    thread_ts?: unknown;
    team?: unknown;
    /** The poster's home workspace; differs from team_id for someone from another workspace. */
    user_team?: unknown;
  };
};

const str = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** The app's own bot user id, from the event's authorizations. */
function botUserId(authorizations: unknown): string | undefined {
  if (!Array.isArray(authorizations)) return undefined;
  const bot = authorizations.find(
    (entry): entry is { user_id: string } =>
      Boolean(entry) &&
      (entry as { is_bot?: unknown }).is_bot === true &&
      typeof (entry as { user_id?: unknown }).user_id === 'string'
  );
  return bot ? str(bot.user_id, 64) || undefined : undefined;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The question of a channel message addressed to Squire by name as plain text ("@Squire investigate"):
 * Slack has no user called Squire to mention, so the app sees it as an ordinary message. Null for any
 * other message, including one that also mentions the app (that arrives as `app_mention`). Mentions of
 * other people ("@Squire ask <@U123> …") are fine; with the bot's id unknown any mention is skipped.
 */
export function squireAddressedText(
  text: string,
  squireName: string,
  botUserId?: string
): string | null {
  if (!/^\s*@/.test(text)) return null;
  if (botUserId ? text.includes(`<@${botUserId}`) : text.includes('<@')) return null;
  const names = [...new Set(['squire', squireName.toLowerCase()])].map(escapeRegExp).join('|');
  // eslint-disable-next-line security/detect-non-literal-regexp -- built from escaped names only
  const prefix = new RegExp(`^\\s*@(?:${names})(?=$|[\\s:,])[:,]?`, 'i');
  return prefix.test(text) ? text.replace(prefix, ' ').trim() : null;
}

export const SQUIRE_CHAT_OFF_NOTICE =
  'Squire is turned off for chat; an admin can enable it in Settings → Intelligence → AI';

/**
 * One private "Squire is off" reply to the asker (at most once per person per ten minutes), sent within
 * the events request, so it is a single bounded call and failures are ignored.
 */
async function tellSquireIsOff(payload: SlackSquireMentionPayload): Promise<void> {
  try {
    const once = await checkRateLimit(
      `squire:chatops:slack-off:${payload.team_id}:${payload.user_id}`,
      1,
      10 * 60_000
    );
    if (!once.allowed) return;
    const token = await slackInstallationToken(payload.team_id);
    if (!token) return;
    await fetch('https://slack.com/api/chat.postEphemeral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        channel: payload.channel_id,
        user: payload.user_id,
        ...(payload.thread_ts ? { thread_ts: payload.thread_ts } : {}),
        text: SQUIRE_CHAT_OFF_NOTICE,
      }),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Best effort: the mention is already logged.
  }
}

/**
 * Route side of `@squire`: validate the signed `app_mention` event (or a channel message that starts with
 * "@Squire") and queue it. Bots (including this one) are ignored, and nothing is queued while Squire is off
 * for chat; the asker gets one private notice saying so instead of silence. Slack redelivers an event with the same `event_id`; that id
 * is the de-duplication key.
 */
export async function enqueueSlackSquireMention(envelope: SlackEventEnvelope): Promise<boolean> {
  const event = envelope.event;
  if (!event || event.bot_id) return false;
  const teamId = str(envelope.team_id, 64) || str(event.team, 64);
  // Someone from another workspace in a shared channel is never answered as a member of this one.
  const userTeam = str(event.user_team, 64);
  if (userTeam && userTeam !== teamId) return false;
  let text = str(event.text, 4_000);
  if (event.type === 'message') {
    // Cheap test first: every channel message passes through here.
    if (event.subtype || !/^\s*@/.test(text)) return false;
    const addressed = squireAddressedText(
      text,
      (await loadSquireIdentity()).name,
      botUserId(envelope.authorizations)
    );
    if (addressed === null) return false;
    // Plain-text addressing is only for incident channels; elsewhere "@Squire" is just text.
    if (!(await findSlackIncidentForChannel(teamId, str(event.channel, 64)))) return false;
    text = addressed;
  } else if (event.type !== 'app_mention') return false;
  const enterpriseId = str(envelope.enterprise_id, 64);
  const payload: SlackSquireMentionPayload = {
    __kind: 'SQUIRE_MENTION',
    team_id: teamId,
    ...(enterpriseId ? { enterprise_id: enterpriseId } : {}),
    channel_id: str(event.channel, 64),
    user_id: str(event.user, 64),
    text,
    ts: str(event.ts, 64),
    ...(str(event.thread_ts, 64) ? { thread_ts: str(event.thread_ts, 64) } : {}),
  };
  const eventId = str(envelope.event_id, 128);
  if (!payload.team_id || !payload.channel_id || !payload.user_id || !payload.ts || !eventId)
    return false;
  if (!(await isSquireChatOpsEnabled())) {
    logger.info('[Squire] Slack mention ignored: Squire is turned off for chat', {
      teamId: payload.team_id,
    });
    await tellSquireIsOff(payload);
    return false;
  }
  try {
    await enqueueChatOpsIntent({
      provider: 'SLACK',
      kind: 'SLASH_COMMAND',
      signature: `squire-mention:${payload.team_id}:${eventId}`,
      workspaceId: payload.team_id,
      channelId: payload.channel_id,
      slackUserId: payload.user_id,
      responseMode: 'DEFERRED',
      payload: { ...payload },
    });
    return true;
  } catch (error) {
    logger.warn('[Squire] Could not queue a Slack mention', {
      error: error instanceof Error ? error.name : 'error',
    });
    return false;
  }
}
