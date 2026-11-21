import 'server-only';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import { logger } from '@/lib/logger';
import { isSquireChatOpsEnabled } from './handler';
import type { SlackSquireMentionPayload } from './slack';

type SlackEventEnvelope = {
  team_id?: unknown;
  event_id?: unknown;
  event?: {
    type?: unknown;
    user?: unknown;
    bot_id?: unknown;
    text?: unknown;
    channel?: unknown;
    ts?: unknown;
    thread_ts?: unknown;
    team?: unknown;
  };
};

const str = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * Route side of `@squire`: validate the signed `app_mention` event and queue it. Bots (including this
 * one) are ignored, and nothing is queued while Squire is off for chat, so a disabled feature costs no
 * work. Slack redelivers an event with the same `event_id`; that id is the de-duplication key.
 */
export async function enqueueSlackSquireMention(envelope: SlackEventEnvelope): Promise<boolean> {
  const event = envelope.event;
  if (!event || event.type !== 'app_mention' || event.bot_id) return false;
  const payload: SlackSquireMentionPayload = {
    __kind: 'SQUIRE_MENTION',
    team_id: str(envelope.team_id, 64) || str(event.team, 64),
    channel_id: str(event.channel, 64),
    user_id: str(event.user, 64),
    text: str(event.text, 4_000),
    ts: str(event.ts, 64),
    ...(str(event.thread_ts, 64) ? { thread_ts: str(event.thread_ts, 64) } : {}),
  };
  const eventId = str(envelope.event_id, 128);
  if (!payload.team_id || !payload.channel_id || !payload.user_id || !payload.ts || !eventId)
    return false;
  if (!(await isSquireChatOpsEnabled())) return false;
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
