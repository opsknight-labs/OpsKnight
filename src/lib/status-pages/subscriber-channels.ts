import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { decryptStoredSecret } from '@/lib/encryption';
import { getBaseUrl } from '@/lib/env-validation';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import {
  createCentralNotificationIntentsBatch,
  type CentralNotificationInput,
} from '@/lib/notification-control-plane';
import { slackTextBody, teamsWebhookBody } from '@/lib/chat-text';
import { issueUnsubscribeTokensBatch } from './subscription-tokens';
import { subscriberServiceFilter } from './subscription-policy';
import {
  pageSubscriberChannels,
  ROW_CHANNELS,
  smsUpdateText,
  type ChatChannel,
} from './subscriber-channel-policy';

const PAGE_SIZE = 500;

export function chatMessageBody(
  channel: ChatChannel,
  title: string,
  message: string,
  links: Array<{ label: string; url: string }>
) {
  return channel === 'SLACK'
    ? slackTextBody(title, message, links)
    : teamsWebhookBody(title, message, links);
}

type PageForFanout = {
  id: string;
  subscriberChannels?: string[] | null;
} & Parameters<typeof getStatusPagePublicUrl>[0];

/**
 * Queues an update for a page's SMS, Slack and Teams subscribers who follow the affected
 * services (`serviceIds: null` = the whole page). One durable intent per subscriber under the
 * caller's event key, so a retried fan-out never sends twice; recipients are SUBSCRIBER rows,
 * so an unsubscribe skips anything still queued. Channels the page switched off send nothing.
 */
export async function notifyChannelSubscribers(input: {
  page: PageForFanout;
  serviceIds: readonly string[] | null;
  /** Already carries the page name, e.g. "[Acme] Investigating: Login errors". */
  title: string;
  message: string;
  eventKey: string;
  templateKey: string;
  sourceType: string;
  sourceId: string;
  incidentId?: string;
  trafficClass?: CentralNotificationInput['trafficClass'];
  priority?: number;
}): Promise<number> {
  const enabled = pageSubscriberChannels(input.page);
  const channels = ROW_CHANNELS.filter(channel => enabled.includes(channel));
  if (!channels.length) return 0;
  const statusPageUrl = getStatusPagePublicUrl(input.page, getBaseUrl());
  const title = input.title;
  let queued = 0;
  for (let cursor: string | undefined; ;) {
    const subscriptions = await prisma.statusPageSubscription.findMany({
      where: {
        statusPageId: input.page.id,
        channel: { in: [...channels] },
        state: 'ACTIVE',
        verified: true,
        unsubscribedAt: null,
        ...(input.serviceIds ? subscriberServiceFilter(input.serviceIds) : {}),
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, channel: true, phone: true, targetEncrypted: true },
    });
    if (!subscriptions.length) break;
    cursor = subscriptions.at(-1)!.id;
    const tokens = await issueUnsubscribeTokensBatch(subscriptions.map(sub => sub.id));
    const intents: CentralNotificationInput[] = [];
    for (const sub of subscriptions) {
      const unsubscribeUrl = `${statusPageUrl}/unsubscribe/${tokens.get(sub.id)}`;
      const base = {
        category: 'STATUS_PAGE' as const,
        recipientType: 'SUBSCRIBER' as const,
        recipientId: sub.id,
        incidentId: input.incidentId,
        templateKey: input.templateKey,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        eventKey: input.eventKey,
        displayMessage: title.slice(0, 2_000),
        ...(input.trafficClass ? { trafficClass: input.trafficClass } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      };
      if (sub.channel === 'SMS') {
        if (!sub.phone) continue;
        intents.push({
          ...base,
          channel: 'SMS',
          recipientAddress: sub.phone,
          payload: {
            kind: 'SMS',
            to: sub.phone,
            message: smsUpdateText(title, statusPageUrl, unsubscribeUrl),
          },
        });
        continue;
      }
      const url = sub.targetEncrypted
        ? await decryptStoredSecret(sub.targetEncrypted).catch(() => null)
        : null;
      if (!url) {
        logger.warn('status_page.channel_subscriber_target_unreadable', { subscriptionId: sub.id });
        continue;
      }
      intents.push({
        ...base,
        channel: 'WEBHOOK',
        recipientAddress: url,
        payload: {
          kind: 'WEBHOOK',
          url,
          payload: chatMessageBody(sub.channel as ChatChannel, title, input.message, [
            { label: 'View status page', url: statusPageUrl },
            { label: 'Unsubscribe', url: unsubscribeUrl },
          ]),
        },
      });
    }
    if (intents.length) queued += (await createCentralNotificationIntentsBatch(intents)).created;
    if (subscriptions.length < PAGE_SIZE) break;
  }
  return queued;
}
