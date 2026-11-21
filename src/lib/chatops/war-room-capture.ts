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
  };
};

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
  'CAPTURED' | 'NOT_A_PERSON_MESSAGE' | 'DISABLED' | 'NOT_A_WAR_ROOM' | 'LIMIT_REACHED';

/** Route side of a signed `message` event. */
export async function captureSlackChannelMessage(
  envelope: SlackMessageEnvelope,
  client: typeof prisma = prisma
): Promise<CaptureOutcome> {
  const event = envelope.event;
  const text = str(event?.text);
  const user = str(event?.user);
  const channel = str(event?.channel);
  const ts = Number(str(event?.ts));
  // Edited, removed and joined messages and bot posts (this app's own too) carry a subtype or a bot id.
  if (
    !event ||
    event.type !== 'message' ||
    event.subtype ||
    event.bot_id ||
    !text ||
    !user ||
    !channel ||
    !Number.isFinite(ts)
  )
    return 'NOT_A_PERSON_MESSAGE';
  const channelType = str(event.channel_type);
  if (channelType !== 'channel' && channelType !== 'group') return 'NOT_A_WAR_ROOM';
  if (!(await captureEnabled(client))) return 'DISABLED';
  const workspaceId = str(envelope.team_id) || str(event.team);
  const incident = await findSlackIncidentForChannel(workspaceId, channel);
  if (!incident) return 'NOT_A_WAR_ROOM';
  // shortcut: count-then-insert can overshoot the cap by a few under concurrent messages; a hard cap needs a counter row.
  const stored = await client.incidentEvent.count({
    where: { incidentId: incident.id, type: 'CHAT_MESSAGE' },
  });
  if (stored >= CAPTURE_LIMITS.perIncident) return 'LIMIT_REACHED';
  await client.incidentEvent.create({
    data: {
      incidentId: incident.id,
      type: 'CHAT_MESSAGE',
      message: clipBytes(redactSecrets(`Slack user ${user}: ${text}`), CAPTURE_LIMITS.messageBytes),
      createdAt: new Date(ts * 1000),
    },
  });
  return 'CAPTURED';
}
