import 'server-only';
import prisma from '@/lib/prisma';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { redactSecrets } from '@/lib/intelligence/ai/redact';
import { findSlackIncidentForChannel } from '@/lib/chatops/squire/slack';

/**
 * War-room channel capture: people's messages in an incident's Slack war room saved as CHAT_MESSAGE
 * timeline entries, so the time axis and the postmortem draft include the discussion (not only pins).
 * Off unless an administrator turns it on. Bounded per incident and per message; secrets are redacted before
 * anything is stored. Incident visibility (PUBLIC/PRIVATE) is not consulted: it only controls the status page.
 */

export const CAPTURE_LIMITS = { perIncident: 2_000, messageBytes: 4_096 } as const;

type SlackMessageEnvelope = {
  team_id?: unknown;
  event?: {
    type?: unknown;
    subtype?: unknown;
    bot_id?: unknown;
    user?: unknown;
    text?: unknown;
    channel?: unknown;
    channel_type?: unknown;
    ts?: unknown;
    team?: unknown;
    /** message_changed: the new version of the message. */
    message?: { user?: unknown; text?: unknown; ts?: unknown; bot_id?: unknown; subtype?: unknown };
    /** message_deleted: ts of the removed message and its former content. */
    deleted_ts?: unknown;
    previous_message?: { user?: unknown; ts?: unknown; bot_id?: unknown };
  };
  /** Present on Enterprise Grid deliveries. */
  enterprise_id?: unknown;
};

/** Shorter messages ("ok", "+1") are chatter, not timeline material. */
export const MIN_CAPTURE_CHARS = 3;

/**
 * Every message in every channel the bot sits in reaches the route, so the switch is read at most once per
 * TTL per process instead of once per message. A change takes up to the TTL to apply.
 */
const SWITCH_TTL_MS = 30_000;
let captureSwitch: { on: boolean; readAt: number } | null = null;

async function captureEnabled(client: typeof prisma): Promise<boolean> {
  if (captureSwitch && Date.now() - captureSwitch.readAt < SWITCH_TTL_MS) return captureSwitch.on;
  const settings = await getIntelligenceSettings(client);
  captureSwitch = { on: settings.enabled && settings.warRoomCaptureEnabled, readAt: Date.now() };
  return captureSwitch.on;
}

/** Tests flip the switch between cases. */
export function resetCaptureSwitchCache() {
  captureSwitch = null;
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Cuts to a UTF-8 byte budget without splitting a character. */
export function clipBytes(text: string, max: number): string {
  if (Buffer.byteLength(text, 'utf8') <= max) return text;
  let out = '';
  let bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > max - 3) break;
    out += char;
    bytes += size;
  }
  return `${out}…`;
}

export type CaptureOutcome =
  | 'CAPTURED'
  | 'UPDATED'
  | 'REMOVED'
  | 'NOT_A_PERSON_MESSAGE'
  | 'DISABLED'
  | 'NOT_A_WAR_ROOM'
  | 'LIMIT_REACHED';

const entryPrefix = (user: string) => `Slack user ${user}: `;
const entryText = (user: string, text: string) =>
  clipBytes(redactSecrets(`${entryPrefix(user)}${text}`), CAPTURE_LIMITS.messageBytes);

/** Route side of a signed `message` event. */
export async function captureSlackChannelMessage(
  envelope: SlackMessageEnvelope,
  client: typeof prisma = prisma
): Promise<CaptureOutcome> {
  const event = envelope.event;
  if (!event || event.type !== 'message') return 'NOT_A_PERSON_MESSAGE';
  const subtype = str(event.subtype);
  const edited = subtype === 'message_changed';
  const deleted = subtype === 'message_deleted';
  // The person's message: the event itself, or the inner message of an edit / the one a delete removed.
  const inner = edited ? event.message : deleted ? event.previous_message : event;
  const text = edited ? str(event.message?.text) : str(event.text);
  const user = str(inner?.user);
  const channel = str(event.channel);
  const ts = Number(str(edited ? event.message?.ts : deleted ? event.deleted_ts : event.ts));
  // Joins, topic changes, file shares, bot posts (this app's own too) and other subtypes are not people talking.
  if (
    (subtype && !edited && !deleted) ||
    event.bot_id ||
    inner?.bot_id ||
    (edited && event.message?.subtype) ||
    (!deleted && !text) ||
    !user ||
    !channel ||
    !Number.isFinite(ts)
  )
    return 'NOT_A_PERSON_MESSAGE';
  const channelType = str(event.channel_type);
  if (channelType !== 'channel' && channelType !== 'group') return 'NOT_A_WAR_ROOM';
  if (!(await captureEnabled(client))) return 'DISABLED';
  const enterpriseId = str(envelope.enterprise_id);
  const teamId = str(envelope.team_id) || str(event.team);
  const workspaceId = enterpriseId
    ? await (
        await import('@/lib/slack/workspace-match')
      ).resolveSlackWorkspaceKey(teamId, enterpriseId)
    : teamId;
  const incident = await findSlackIncidentForChannel(workspaceId, channel);
  if (!incident) return 'NOT_A_WAR_ROOM';
  if (!deleted && text.length < MIN_CAPTURE_CHARS) return 'NOT_A_PERSON_MESSAGE';
  const createdAt = new Date(ts * 1000);
  // A stored entry is found by its Slack timestamp and author (no extra column needed).
  const entry = {
    incidentId: incident.id,
    type: 'CHAT_MESSAGE' as const,
    createdAt,
    message: { startsWith: entryPrefix(user) },
  };
  if (deleted) {
    const removed = await client.incidentEvent.deleteMany({ where: entry });
    return removed.count > 0 ? 'REMOVED' : 'NOT_A_PERSON_MESSAGE';
  }
  if (edited) {
    // An edit of a message that was never captured (older than the switch, or too short) adds nothing.
    const updated = await client.incidentEvent.updateMany({
      where: entry,
      data: { message: entryText(user, text) },
    });
    return updated.count > 0 ? 'UPDATED' : 'NOT_A_PERSON_MESSAGE';
  }
  // shortcut: count-then-insert can overshoot the cap by a few under concurrent messages; a hard cap needs a counter row.
  const stored = await client.incidentEvent.count({
    where: { incidentId: incident.id, type: 'CHAT_MESSAGE' },
  });
  if (stored >= CAPTURE_LIMITS.perIncident) return 'LIMIT_REACHED';
  await client.incidentEvent.create({
    data: {
      incidentId: incident.id,
      type: 'CHAT_MESSAGE',
      message: entryText(user, text),
      createdAt,
    },
  });
  return 'CAPTURED';
}
