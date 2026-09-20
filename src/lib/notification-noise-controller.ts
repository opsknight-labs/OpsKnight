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
  const relatedCount = await store.notification.count({
    where: {
      recipientId: input.recipientId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      eventType: input.eventType,
      createdAt: { gte: new Date(now.getTime() - 60_000) },
    },
  });
  return decideNotificationNoise(input, relatedCount, now);
}
