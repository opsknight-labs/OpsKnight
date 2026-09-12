import prisma from '@/lib/prisma';
import type { NotificationChannel } from '@prisma/client';

export async function findProviderCapacity(input: {
  provider: string;
  channel: NotificationChannel;
}) {
  return prisma.notificationProviderCapacity.findUnique({
    where: { provider_channel: { provider: input.provider, channel: input.channel } },
  });
}

export async function findManyProviderCapacities() {
  return prisma.notificationProviderCapacity.findMany({ orderBy: [{ provider: 'asc' }, { channel: 'asc' }] });
}

export async function findRuntimeSettings() {
  return prisma.notificationRuntimeSettings.findUnique({ where: { id: 'default' } });
}

export async function upsertRuntimeSettings(input: {
  bulkQueueLowWatermark: number;
  bulkQueueHighWatermark: number;
  defaultBulkSharePercent: number;
  adaptiveBackpressure: boolean;
  updatedBy?: string | null;
}) {
  return prisma.notificationRuntimeSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      bulkQueueLowWatermark: input.bulkQueueLowWatermark,
      bulkQueueHighWatermark: input.bulkQueueHighWatermark,
      defaultBulkSharePercent: input.defaultBulkSharePercent,
      adaptiveBackpressure: input.adaptiveBackpressure,
      updatedBy: input.updatedBy ?? null,
    },
    update: {
      bulkQueueLowWatermark: input.bulkQueueLowWatermark,
      bulkQueueHighWatermark: input.bulkQueueHighWatermark,
      defaultBulkSharePercent: input.defaultBulkSharePercent,
      adaptiveBackpressure: input.adaptiveBackpressure,
      updatedBy: input.updatedBy ?? null,
    },
  });
}
