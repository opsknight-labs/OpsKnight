import { createHash } from 'node:crypto';
import prisma from './prisma';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function deliveryMarkerId(namespace: string, deliveryKey: string, targetId: string): string {
  return `delivery:${hash(`${namespace}\u001f${deliveryKey}\u001f${targetId}`)}`;
}

export async function isDeliveryComplete(markerId: string): Promise<boolean> {
  const marker = await prisma.backgroundJob.findUnique({
    where: { id: markerId },
    select: { status: true },
  });
  return marker?.status === 'COMPLETED';
}

export async function markDeliveryComplete(input: {
  markerId: string;
  namespace: string;
  deliveryKey: string;
  targetId: string;
}): Promise<void> {
  const now = new Date();
  await prisma.backgroundJob.upsert({
    where: { id: input.markerId },
    update: {
      status: 'COMPLETED',
      completedAt: now,
      failedAt: null,
      error: null,
      payload: {
        task: 'DELIVERY_MARKER',
        namespace: input.namespace,
        deliveryKey: input.deliveryKey,
        targetId: input.targetId,
      },
    },
    create: {
      id: input.markerId,
      type: 'SCHEDULED_TASK',
      status: 'COMPLETED',
      scheduledAt: now,
      completedAt: now,
      maxAttempts: 1,
      payload: {
        task: 'DELIVERY_MARKER',
        namespace: input.namespace,
        deliveryKey: input.deliveryKey,
        targetId: input.targetId,
      },
    },
  });
}
