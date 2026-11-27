import prisma from '@/lib/prisma';
import { createCentralNotificationIntent } from '@/lib/notification-control-plane';

/** A Slack or Microsoft Teams channel the OpsKnight bot can post to. */
export type ChatChannelRef =
  | { provider: 'SLACK'; channel: string }
  | { provider: 'MICROSOFT_TEAMS'; tenantId: string; teamId: string; channel: string };

const SLACK_CHANNEL_ID = /^[CG][A-Z0-9]{8,}$/;
const SLACK_CHANNEL_NAME = /^#[a-z0-9][a-z0-9._-]{0,79}$/;
const TEAMS_CHANNEL_ID = /^19:[^\s/]+@thread\.(?:tacv2|skype)$/;
/** Bounded so one business service never floods chat. */
export const MAX_CHAT_TARGETS = 5;

/**
 * Reads a business service's free-text `contactChannel` as a chat channel when it is one: a Slack
 * channel id, `#name` or `…slack.com/archives/<id>` link, or a Teams "Get link to channel" URL.
 * Anything else (an email, a phone number, prose) stays free text and returns null.
 */
export function parseChatChannel(raw: string | null | undefined): ChatChannelRef | null {
  const value = raw?.trim();
  if (!value) return null;
  if (SLACK_CHANNEL_ID.test(value) || SLACK_CHANNEL_NAME.test(value))
    return { provider: 'SLACK', channel: value };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host === 'slack.com' || host.endsWith('.slack.com')) {
    const id = /^\/archives\/([CG][A-Z0-9]{8,})(?:\/|$)/.exec(url.pathname)?.[1];
    return id ? { provider: 'SLACK', channel: id } : null;
  }
  if (host === 'teams.microsoft.com' || host === 'teams.cloud.microsoft') {
    const encoded = /^\/l\/channel\/([^/]+)/.exec(url.pathname)?.[1];
    const teamId = url.searchParams.get('groupId')?.trim();
    const tenantId = url.searchParams.get('tenantId')?.trim();
    if (!encoded || !teamId || !tenantId) return null;
    let channel: string;
    try {
      channel = decodeURIComponent(encoded);
    } catch {
      return null;
    }
    return TEAMS_CHANNEL_ID.test(channel)
      ? { provider: 'MICROSOFT_TEAMS', tenantId, teamId, channel }
      : null;
  }
  return null;
}

export function chatChannelKey(ref: ChatChannelRef): string {
  return ref.provider === 'SLACK'
    ? `slack:${ref.channel.toLowerCase()}`
    : `teams:${ref.tenantId}:${ref.teamId}:${ref.channel}`;
}

/** A clickable link for a contact channel, or null for free text and bare `#name`s. */
export function contactChannelHref(raw: string | null | undefined): string | null {
  const ref = parseChatChannel(raw);
  if (!ref) return null;
  const value = raw!.trim();
  if (value.startsWith('https://')) return value;
  return ref.provider === 'SLACK' && SLACK_CHANNEL_ID.test(ref.channel)
    ? `https://slack.com/app_redirect?channel=${ref.channel}`
    : null;
}

/**
 * Checks a contact channel against the connected workspace. Returns an error message only when
 * the value is a chat channel and the connected Slack/Teams says it is not reachable; free text,
 * `#name`s and anything that cannot be checked (nothing connected, provider down) pass.
 */
export async function validateContactChannel(
  raw: string | null | undefined
): Promise<string | null> {
  const ref = parseChatChannel(raw);
  if (!ref) return null;
  if (ref.provider === 'SLACK') {
    if (!SLACK_CHANNEL_ID.test(ref.channel)) return null;
    const { slackChannelExists } = await import('@/lib/slack');
    return (await slackChannelExists(ref.channel)) === false
      ? 'That Slack channel was not found in the connected workspace (invite the OpsKnight app to private channels).'
      : null;
  }
  const configured = await prisma.microsoftTeamsConfig.findFirst({
    where: { enabled: true },
    select: { id: true },
  });
  if (!configured) return null;
  const installed = await prisma.microsoftTeamsInstallation.findFirst({
    where: { tenantId: ref.tenantId, teamId: ref.teamId, enabled: true },
    select: { id: true },
  });
  return installed
    ? null
    : 'OpsKnight is not installed in that Microsoft Teams team. Install the app there first.';
}

/**
 * Where a business service's chat updates go: its contact channel (when it is a chat channel),
 * then the Slack/Teams channels configured on member services its owner team owns. Deduplicated.
 */
export async function businessServiceChatTargets(bs: {
  id: string;
  contactChannel: string | null;
  ownerTeamId: string | null;
}): Promise<ChatChannelRef[]> {
  const refs: ChatChannelRef[] = [];
  const contact = parseChatChannel(bs.contactChannel);
  if (contact) refs.push(contact);
  if (bs.ownerTeamId) {
    const ownedMember = {
      teamId: bs.ownerTeamId,
      businessServiceMemberships: { some: { businessServiceId: bs.id } },
    };
    const [slack, teams] = await Promise.all([
      prisma.slackDestination.findMany({
        where: { enabled: true, service: ownedMember },
        select: { channelId: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_CHAT_TARGETS,
      }),
      prisma.microsoftTeamsDestination.findMany({
        where: { enabled: true, service: ownedMember },
        select: { tenantId: true, teamId: true, channelId: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_CHAT_TARGETS,
      }),
    ]);
    for (const row of slack) refs.push({ provider: 'SLACK', channel: row.channelId });
    for (const row of teams)
      refs.push({
        provider: 'MICROSOFT_TEAMS',
        tenantId: row.tenantId,
        teamId: row.teamId,
        channel: row.channelId,
      });
  }
  const seen = new Set<string>();
  return refs
    .filter(ref => {
      const key = chatChannelKey(ref);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CHAT_TARGETS);
}

/**
 * Queues one durable chat post per target through the central notification outbox (retries,
 * circuit breaker). The delivery key is (target, template, business service, eventKey), so a
 * repeated call for the same event never posts twice.
 */
export async function enqueueBusinessServiceChat(input: {
  businessServiceId: string;
  targets: readonly ChatChannelRef[];
  title: string;
  text: string;
  url?: string;
  templateKey: string;
  eventKey: string;
}): Promise<number> {
  let queued = 0;
  for (const target of input.targets) {
    const result = await createCentralNotificationIntent({
      category: 'SYSTEM',
      channel: target.provider,
      recipientType: target.provider === 'SLACK' ? 'SLACK_CHANNEL' : 'MICROSOFT_TEAMS_CHANNEL',
      recipientAddress: chatChannelKey(target),
      templateKey: input.templateKey,
      sourceType: 'BUSINESS_SERVICE',
      sourceId: input.businessServiceId,
      eventKey: input.eventKey,
      displayMessage: input.title,
      trafficClass: 'TRANSACTIONAL',
      payload: {
        kind: 'CHAT_TEXT',
        provider: target.provider,
        channel: target.channel,
        ...(target.provider === 'MICROSOFT_TEAMS'
          ? { tenantId: target.tenantId, teamId: target.teamId }
          : {}),
        title: input.title,
        text: input.text,
        ...(input.url ? { url: input.url } : {}),
      },
    });
    if (result.created) queued += 1;
  }
  return queued;
}
