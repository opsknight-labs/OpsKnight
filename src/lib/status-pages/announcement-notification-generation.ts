import 'server-only';

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

type GenerationStore = Pick<typeof prisma, '$queryRaw'>;

export async function readAnnouncementNotificationGeneration(
  announcementId: string,
  statusPageId: string,
  store: GenerationStore = prisma
): Promise<number | null> {
  const rows = await store.$queryRaw<Array<{ notificationGeneration: number }>>(Prisma.sql`
    SELECT "notificationGeneration"
    FROM "StatusPageAnnouncement"
    WHERE "id" = ${announcementId}
      AND "statusPageId" = ${statusPageId}
    LIMIT 1
  `);
  const value = rows[0]?.notificationGeneration;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function incrementAnnouncementNotificationGeneration(
  announcementId: string,
  statusPageId: string,
  tx: Prisma.TransactionClient
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ notificationGeneration: number }>>(Prisma.sql`
    UPDATE "StatusPageAnnouncement"
    SET "notificationGeneration" = "notificationGeneration" + 1
    WHERE "id" = ${announcementId}
      AND "statusPageId" = ${statusPageId}
    RETURNING "notificationGeneration"
  `);
  const value = rows[0]?.notificationGeneration;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Announcement notification generation could not be advanced');
  }
  return value;
}

export function announcementGenerationEventKey(generation: number): string {
  return `generation:${generation}`;
}
