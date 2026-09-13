import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

type GenerationStore = Pick<typeof prisma, 'statusPageAnnouncement'>;

export async function readAnnouncementNotificationGeneration(
  announcementId: string,
  statusPageId: string,
  store: GenerationStore = prisma
): Promise<number | null> {
  const announcement = await store.statusPageAnnouncement.findFirst({
    where: { id: announcementId, statusPageId },
    select: { notificationGeneration: true },
  });
  const value = announcement?.notificationGeneration;
  return Number.isSafeInteger(value) && value != null && value >= 0 ? value : null;
}

export async function incrementAnnouncementNotificationGeneration(
  announcementId: string,
  statusPageId: string,
  tx: Prisma.TransactionClient
): Promise<number> {
  const updated = await tx.statusPageAnnouncement.updateMany({
    where: { id: announcementId, statusPageId },
    data: { notificationGeneration: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new Error('Announcement notification generation could not be advanced');
  }

  const announcement = await tx.statusPageAnnouncement.findFirst({
    where: { id: announcementId, statusPageId },
    select: { notificationGeneration: true },
  });
  const value = announcement?.notificationGeneration;
  if (!Number.isSafeInteger(value) || value == null || value < 0) {
    throw new Error('Announcement notification generation could not be read after update');
  }
  return value;
}

export function announcementGenerationEventKey(generation: number): string {
  return `generation:${generation}`;
}
