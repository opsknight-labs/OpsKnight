import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { incrementAnnouncementNotificationGeneration } from '@/lib/status-pages/announcement-notification-generation';
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

const endedAnnouncementSelect = {
  id: true,
  title: true,
  message: true,
  type: true,
  isActive: true,
  startDate: true,
  endDate: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StatusPageAnnouncementSelect;

/**
 * Ends an announcement now: it stops showing on the page and subscriber notices that have not gone out
 * are cancelled. Ending one that is already inactive answers the same success without a second audit row.
 */
export async function endAnnouncement(
  input: {
    statusPageId: string;
    announcementId: string;
    actorId: string;
    source: AuditEventSource;
  },
  client?: Prisma.TransactionClient
) {
  const { statusPageId, announcementId } = input;
  const run = async (tx: Prisma.TransactionClient) => {
    await lockAnnouncementMutation(tx, statusPageId, announcementId);
    const existing = await tx.statusPageAnnouncement.findFirst({
      where: { id: announcementId, statusPageId },
      select: endedAnnouncementSelect,
    });
    if (!existing) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'The announcement was not found on this status page.',
      });
    }
    if (!existing.isActive) return existing;

    const ended = await tx.statusPageAnnouncement.update({
      where: { id: announcementId },
      data: { isActive: false },
      select: endedAnnouncementSelect,
    });
    await incrementAnnouncementNotificationGeneration(announcementId, statusPageId, tx);
    await cancelPendingAnnouncementJobs(tx, announcementId, statusPageId);
    await suppressUndeliveredAnnouncementIntents(
      tx,
      announcementId,
      'Announcement was ended before provider delivery.'
    );
    await emitAuditEvent(
      {
        action: 'status_page.announcement.ended',
        source: input.source,
        actor: { type: 'USER', id: input.actorId },
        target: { type: 'STATUS_PAGE', id: statusPageId },
        metadata: { announcementId, title: existing.title },
      },
      tx
    );
    return ended;
  };
  return client ? run(client) : prisma.$transaction(run);
}
