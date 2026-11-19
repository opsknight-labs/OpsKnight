import 'server-only';

import type { Prisma } from '@prisma/client';
import {
  STATUS_PAGE_ANNOUNCEMENT_FANOUT_V1,
  STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2,
  STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING,
  type AnnouncementFanoutDeliveryMode,
} from '@/lib/status-pages/announcement-fanout-contract';

// Transaction-scoped announcement mutation primitives shared by the settings
// route and service maintenance windows, so both keep one generation/fan-out contract.

export async function lockAnnouncementMutation(
  tx: Prisma.TransactionClient,
  statusPageId: string,
  announcementId: string
) {
  const lockKey = `${statusPageId}:${announcementId}`;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `;
}

export async function cancelPendingAnnouncementJobs(
  tx: Prisma.TransactionClient,
  announcementId: string,
  statusPageId: string
) {
  await tx.$executeRaw`
    DELETE FROM "BackgroundJob"
    WHERE (
        ("type" = ${STATUS_PAGE_ANNOUNCEMENT_FANOUT_V1}::"JobType" AND "status" = 'PENDING'::"JobStatus")
        OR
        ("type" = ${STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2}::"JobType" AND "status" = ${STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING}::"JobStatus")
      )
      AND ("payload"->>'announcementId') = ${announcementId}
      AND ("payload"->>'statusPageId') = ${statusPageId}
  `;
}

export async function suppressUndeliveredAnnouncementIntents(
  tx: Prisma.TransactionClient,
  announcementId: string,
  reason: string
) {
  await tx.notification.updateMany({
    where: {
      sourceType: 'STATUS_PAGE_ANNOUNCEMENT',
      sourceId: announcementId,
      status: { in: ['PENDING', 'FAILED'] },
    },
    data: {
      status: 'SKIPPED',
      payloadEncrypted: null,
      lastAttemptAt: null,
      claimToken: null,
      claimedBy: null,
      errorMsg: reason,
    },
  });
}

export async function createAnnouncementFanoutJob(
  tx: Prisma.TransactionClient,
  input: {
    announcementId: string;
    statusPageId: string;
    scheduledAt: Date;
    generation: number;
    deliveryMode: AnnouncementFanoutDeliveryMode;
  }
) {
  return tx.backgroundJob.create({
    data: {
      type: STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2,
      status: STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING,
      scheduledAt: input.scheduledAt,
      maxAttempts: 5,
      payload: {
        announcementId: input.announcementId,
        statusPageId: input.statusPageId,
        notificationGeneration: input.generation,
        deliveryMode: input.deliveryMode,
      },
    },
  });
}
