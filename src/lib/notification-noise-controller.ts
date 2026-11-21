import 'server-only';

import type { NotificationChannel, NotificationTrafficClass, Prisma } from '@prisma/client';
import { NOTIFICATION_PRIORITY } from './notification-priority';

/** Low-urgency pages to one recipient on one channel inside this window arrive as one bundled notification. */
export const BUNDLE_WINDOW_MS = 5 * 60_000;

export type NoiseDecision =
  | { action: 'DELIVER' }
  | { action: 'GROUP'; groupKey: string }
  | { action: 'DEFER'; until: Date }
  /** Held until the window closes, then sent once on behalf of every page suppressed behind it. */
  | { action: 'BUNDLE'; until: Date }
  | { action: 'SUPPRESS'; reason: string };

export type NoiseControlInput = {
  recipientId: string;
  sourceType: string;
  sourceId: string;
  eventType: string;
  trafficClass: NotificationTrafficClass;
  priority: number;
  /**
   * Set for a pre-paging storm child: the notification is keyed on the parent incident's source, so the
   * parent's own post (or the first child's grouped post) counts as related and the rest roll up.
   */
  rollUpParentId?: string | null;
  /**
   * Set by the caller only when the recipient opted in to bundling and the page is low urgency. The
   * controller still refuses to bundle a responder-critical or transactional notification.
   */
  bundle?: boolean;
  /** Needed with `bundle`: pages are bundled per channel, so each channel still gets its first page at once. */
  channel?: NotificationChannel;
};

/**
 * Bundling is opt-in per recipient and never touches a high-urgency page (priority RESPONDER_CRITICAL) or
 * transactional traffic, whatever the caller asked for.
 */
export function isBundleCandidate(
  input: Pick<
    NoiseControlInput,
    'bundle' | 'channel' | 'priority' | 'trafficClass' | 'rollUpParentId'
  >
): boolean {
  return (
    input.bundle === true &&
    Boolean(input.channel) &&
    !input.rollUpParentId &&
    input.priority > NOTIFICATION_PRIORITY.RESPONDER_CRITICAL &&
    input.trafficClass !== 'TRANSACTIONAL'
  );
}

/**
 * The first low-urgency page in a quiet window goes out at once. The next one is held until the window
 * closes and stands for the bundle. Later ones are suppressed only while that held notification is still
 * waiting, so a suppressed page is always followed by a delivery.
 *
 * @param latestScheduledAt latest `scheduledAt` among the recipient's recent low-urgency pages on this
 *   channel that were not suppressed; null when there are none.
 */
export function decideBundle(
  latestScheduledAt: Date | null,
  now: Date = new Date()
): NoiseDecision {
  if (!latestScheduledAt) return { action: 'DELIVER' };
  if (latestScheduledAt > now) {
    return { action: 'SUPPRESS', reason: 'Bundled with other low-urgency pages' };
  }
  return { action: 'BUNDLE', until: new Date(now.getTime() + BUNDLE_WINDOW_MS) };
}

/** One index-backed read on ("userId", "createdAt"), bounded by the window. */
export async function latestBundlePeerScheduledAt(
  store: Pick<Prisma.TransactionClient, 'notification'>,
  input: Pick<NoiseControlInput, 'recipientId' | 'channel' | 'eventType'>,
  now: Date = new Date()
): Promise<Date | null> {
  const peer = await store.notification.findFirst({
    where: {
      userId: input.recipientId,
      createdAt: { gte: new Date(now.getTime() - BUNDLE_WINDOW_MS) },
      channel: input.channel,
      eventType: input.eventType,
      status: { not: 'SKIPPED' },
      priority: { gt: NOTIFICATION_PRIORITY.RESPONDER_CRITICAL },
    },
    orderBy: { scheduledAt: 'desc' },
    select: { scheduledAt: true },
  });
  return peer?.scheduledAt ?? null;
}

/**
 * Critical and transactional pages are deliberately outside noise control, except a storm child's: its
 * parent already paged, so the child is grouped once per recipient and window and suppressed after that.
 */
export function decideNotificationNoise(
  input: NoiseControlInput,
  relatedCount: number,
  now: Date = new Date()
): NoiseDecision {
  if (input.rollUpParentId) {
    const groupKey = [input.recipientId, input.sourceType, input.sourceId, input.eventType].join(
      ':'
    );
    return relatedCount > 0
      ? { action: 'SUPPRESS', reason: `Rolled up under parent incident ${input.rollUpParentId}` }
      : { action: 'GROUP', groupKey };
  }
  if (input.trafficClass === 'CRITICAL' || input.trafficClass === 'TRANSACTIONAL') {
    return { action: 'DELIVER' };
  }
  const groupKey = [input.recipientId, input.sourceType, input.sourceId, input.eventType].join(':');
  if (relatedCount > 15) {
    return { action: 'SUPPRESS', reason: `Grouped under ${groupKey}` };
  }
  if (relatedCount === 15) return { action: 'GROUP', groupKey };
  if (relatedCount >= 5) return { action: 'DEFER', until: new Date(now.getTime() + 60_000) };
  return { action: 'DELIVER' };
}

export async function notificationNoiseDecision(
  store: Pick<Prisma.TransactionClient, 'notification'>,
  input: NoiseControlInput,
  now: Date = new Date()
): Promise<NoiseDecision> {
  if (isBundleCandidate(input)) {
    return decideBundle(await latestBundlePeerScheduledAt(store, input, now), now);
  }
  if (
    !input.rollUpParentId &&
    (input.trafficClass === 'CRITICAL' || input.trafficClass === 'TRANSACTIONAL')
  ) {
    return { action: 'DELIVER' };
  }
  const relatedCount = await countRelatedNotifications(store, input, now);
  return decideNotificationNoise(input, relatedCount, now);
}

export async function countRelatedNotifications(
  store: Pick<Prisma.TransactionClient, 'notification'>,
  input: Pick<NoiseControlInput, 'recipientId' | 'sourceType' | 'sourceId' | 'eventType'>,
  now: Date = new Date()
): Promise<number> {
  return store.notification.count({
    where: {
      recipientId: input.recipientId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      eventType: input.eventType,
      createdAt: { gte: new Date(now.getTime() - 60_000) },
    },
  });
}

export async function countRelatedNotificationGroups(
  store: Pick<Prisma.TransactionClient, 'notification'>,
  inputs: Array<Pick<NoiseControlInput, 'recipientId' | 'sourceType' | 'sourceId' | 'eventType'>>,
  now: Date = new Date()
): Promise<Map<string, number>> {
  const unique = new Map(
    inputs.map(input => [
      JSON.stringify([input.recipientId, input.sourceType, input.sourceId, input.eventType]),
      input,
    ])
  );
  if (unique.size === 0) return new Map();

  const groupedBySource = new Map<
    string,
    { sourceType: string; sourceId: string; eventType: string; recipientIds: string[] }
  >();
  for (const input of unique.values()) {
    const groupKey = JSON.stringify([input.sourceType, input.sourceId, input.eventType]);
    const existing = groupedBySource.get(groupKey);
    if (existing) {
      existing.recipientIds.push(input.recipientId);
    } else {
      groupedBySource.set(groupKey, {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        eventType: input.eventType,
        recipientIds: [input.recipientId],
      });
    }
  }

  const rows = await store.notification.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - 60_000) },
      OR: [...groupedBySource.values()].map(group => ({
        sourceType: group.sourceType,
        sourceId: group.sourceId,
        eventType: group.eventType,
        recipientId: { in: group.recipientIds },
      })),
    },
    select: { recipientId: true, sourceType: true, sourceId: true, eventType: true },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = JSON.stringify([row.recipientId, row.sourceType, row.sourceId, row.eventType]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
