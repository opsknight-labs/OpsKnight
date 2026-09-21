import 'server-only';

import type { NotificationTrafficClass, Prisma } from '@prisma/client';

export type NoiseDecision =
  | { action: 'DELIVER' }
  | { action: 'GROUP'; groupKey: string }
  | { action: 'DEFER'; until: Date }
  | { action: 'SUPPRESS'; reason: string };

export type NoiseControlInput = {
  recipientId: string;
  sourceType: string;
  sourceId: string;
  eventType: string;
  trafficClass: NotificationTrafficClass;
  priority: number;
};

/** Critical and transactional pages are deliberately outside noise control. */
export function decideNotificationNoise(
  input: NoiseControlInput,
  relatedCount: number,
  now: Date = new Date()
): NoiseDecision {
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
  if (input.trafficClass === 'CRITICAL' || input.trafficClass === 'TRANSACTIONAL') {
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
  const rows = await store.notification.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - 60_000) },
      OR: [...unique.values()].map(input => ({
        recipientId: input.recipientId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        eventType: input.eventType,
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
