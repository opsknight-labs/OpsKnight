import { createHash } from 'node:crypto';

/** Every channel a page can offer visitors. EMAIL and WEBHOOK are on by default, the rest off. */
export const SUBSCRIBER_CHANNELS = ['EMAIL', 'WEBHOOK', 'SLACK', 'MICROSOFT_TEAMS', 'SMS'] as const;
export type SubscriberChannel = (typeof SUBSCRIBER_CHANNELS)[number];
export const DEFAULT_SUBSCRIBER_CHANNELS: SubscriberChannel[] = ['EMAIL', 'WEBHOOK'];
/** Channels stored as StatusPageSubscription rows besides email. */
export const ROW_CHANNELS = ['SLACK', 'MICROSOFT_TEAMS', 'SMS'] as const;
export type RowChannel = (typeof ROW_CHANNELS)[number];
export type ChatChannel = 'SLACK' | 'MICROSOFT_TEAMS';

const SMS_MAX_LENGTH = 320;

export function pageSubscriberChannels(page: {
  subscriberChannels?: readonly string[] | null;
}): SubscriberChannel[] {
  if (!page.subscriberChannels) return [...DEFAULT_SUBSCRIBER_CHANNELS];
  return SUBSCRIBER_CHANNELS.filter(channel => page.subscriberChannels!.includes(channel));
}

/** The row's `email` key: unique per page, so the same phone or webhook never subscribes twice. */
export function channelSubscriberKey(channel: RowChannel, target: string): string {
  if (channel === 'SMS') return `sms:${target}`;
  const digest = createHash('sha256').update(target).digest('hex').slice(0, 40);
  return `${channel === 'SLACK' ? 'slack' : 'teams'}:${digest}`;
}

const SLACK_HOOK_PATH = /^\/(?:services|workflows|triggers)\//;
const TEAMS_HOOK_HOSTS = ['.webhook.office.com', '.logic.azure.com', '.api.powerplatform.com'];

/** Incoming-webhook URLs only from Slack / Microsoft (Teams connectors and Workflows). */
export function isChatWebhookHost(channel: ChatChannel, url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') return false;
  if (channel === 'SLACK') return host === 'hooks.slack.com' && SLACK_HOOK_PATH.test(url.pathname);
  return TEAMS_HOOK_HOSTS.some(suffix => host.endsWith(suffix));
}

export function smsUpdateText(title: string, statusPageUrl: string, unsubscribeUrl: string) {
  const tail = ` ${statusPageUrl} Stop: ${unsubscribeUrl}`;
  const room = Math.max(SMS_MAX_LENGTH - tail.length, 40);
  const head = title.length > room ? `${title.slice(0, room - 1)}…` : title;
  return `${head}${tail}`;
}
