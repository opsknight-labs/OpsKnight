import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import {
  StatusAnnouncementCreateSchema,
  StatusAnnouncementDeleteSchema,
  StatusAnnouncementPatchSchema,
} from '@/lib/validation';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';
import {
  deriveAnnouncementNotificationPlan,
  type AnnouncementNotificationTiming,
} from '@/lib/status-pages/announcement-notification-plan';
import {
  incrementAnnouncementNotificationGeneration,
  readAnnouncementNotificationGeneration,
} from '@/lib/status-pages/announcement-notification-generation';

class InvalidDateError extends Error {
  constructor(public readonly fieldName: string) {
    super(`Invalid ${fieldName}`);
    this.name = 'InvalidDateError';
  }
}

class AnnouncementInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnouncementInputError';
  }
}

class AnnouncementNotFoundError extends Error {
  constructor() {
    super('Announcement not found.');
    this.name = 'AnnouncementNotFoundError';
  }
}

function parseDate(value: string, fieldName: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidDateError(fieldName);
  }
  return parsed;
}

function normalizeAffectedServiceIds(value?: string[] | null) {
  if (!Array.isArray(value)) {
    return null;
  }
  const ids = Array.from(
    new Set(value.map(id => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))
  );
  return ids.length > 0 ? ids : null;
}

async function affectedServicesBelongToPage(
  statusPageId: string,
  serviceIds: string[] | null,
  tx: Pick<typeof prisma, 'statusPageService'> = prisma
) {
  if (!serviceIds?.length) return true;
  const count = await tx.statusPageService.count({
    where: { statusPageId, serviceId: { in: serviceIds }, showOnPage: true },
  });
  return count === serviceIds.length;
}

function effectiveNotificationTiming(
  notificationTiming: AnnouncementNotificationTiming | undefined,
  notifySubscribers?: boolean
): AnnouncementNotificationTiming {
  if (notifySubscribers === false) return 'NONE';
  return notificationTiming ?? 'ON_PUBLISH';
}

async function lockAnnouncementMutation(
  tx: Prisma.TransactionClient,
  statusPageId: string,
  announcementId: string
) {
  const lockKey = `${statusPageId}:${announcementId}`;
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `);
}

async function cancelPendingAnnouncementJobs(
  tx: Prisma.TransactionClient,
  announcementId: string,
  statusPageId: string
) {
  await tx.$executeRaw`
    DELETE FROM "BackgroundJob"
    WHERE "type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
      AND ("payload"->>'announcementId') = ${announcementId}
      AND ("payload"->>'statusPageId') = ${statusPageId}
      AND "status" = 'PENDING'
  `;
}

async function suppressUndeliveredAnnouncementIntents(
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
      errorMsg: reason,
    },
  });
}

async function createAnnouncementFanoutJob(
  tx: Prisma.TransactionClient,
  input: {
    announcementId: string;
    statusPageId: string;
    scheduledAt: Date;
    generation: number;
  }
) {
  return tx.backgroundJob.create({
    data: {
      type: 'STATUS_PAGE_ANNOUNCEMENT_FANOUT',
      status: 'PENDING',
      scheduledAt: input.scheduledAt,
      maxAttempts: 5,
      payload: {
        announcementId: input.announcementId,
        statusPageId: input.statusPageId,
        notificationGeneration: input.generation,
      },
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch (_error) {
      return jsonError('Invalid JSON in request body.', 400);
    }
    const parsed = StatusAnnouncementCreateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid request body.', 400, { issues: parsed.error.issues });
    }
    const {
      statusPageId,
      title,
      message,
      type,
      startDate,
      endDate,
      isActive,
      notifySubscribers,
      affectedServiceIds,
      timeMode,
      allDay,
      publishOption,
      notificationTiming,
    } = parsed.data;
    const normalizedAffectedServiceIds = normalizeAffectedServiceIds(affectedServiceIds);

    if (!(await affectedServicesBelongToPage(statusPageId, normalizedAffectedServiceIds))) {
      return jsonError('Affected services must belong to this status page.', 400);
    }

    const parsedStartDate = parseDate(startDate, 'startDate');
    const parsedEndDate = endDate ? parseDate(endDate, 'endDate') : null;
    const isAllDay = allDay ?? timeMode === 'ALL_DAY';
    const effectiveTimeMode = isAllDay ? 'ALL_DAY' : 'EXACT';

    const now = new Date();
    let effectivePublishAt = now;
    if (parsed.data.publishAt) {
      effectivePublishAt = parseDate(parsed.data.publishAt, 'publishAt');
    } else if (publishOption === 'AT_START') {
      effectivePublishAt = parsedStartDate;
    }

    const timing = effectiveNotificationTiming(notificationTiming, notifySubscribers);
    const active = isActive !== false;
    const plan = deriveAnnouncementNotificationPlan({
      isActive: active,
      notificationTiming: timing,
      publishAt: effectivePublishAt,
      startDate: parsedStartDate,
    });

    const result = await prisma.$transaction(async tx => {
      const announcement = await tx.statusPageAnnouncement.create({
        data: {
          statusPageId,
          title: title.trim(),
          message: message.trim(),
          type: type || 'INFO',
          startDate: parsedStartDate,
          endDate: parsedEndDate,
          allDay: isAllDay,
          timeMode: effectiveTimeMode,
          publishAt: effectivePublishAt,
          notificationTiming: timing,
          isActive: active,
          affectedServiceIds:
            normalizedAffectedServiceIds === null
              ? Prisma.JsonNull
              : (normalizedAffectedServiceIds as Prisma.InputJsonValue),
        },
      });
      const generation =
        (await readAnnouncementNotificationGeneration(announcement.id, statusPageId, tx)) ?? 0;

      if (plan.shouldNotify && plan.scheduledAt) {
        await createAnnouncementFanoutJob(tx, {
          announcementId: announcement.id,
          statusPageId,
          scheduledAt: plan.scheduledAt,
          generation,
        });
      }
      return { announcement, generation };
    });

    logger.info('api.status_page.announcement.created', {
      announcementId: result.announcement.id,
      timeMode: effectiveTimeMode,
      publishAt: effectivePublishAt,
      notificationTiming: timing,
      notificationGeneration: result.generation,
      scheduledNotificationAt: plan.scheduledAt,
    });
    return jsonOk({ announcement: result.announcement }, 200);
  } catch (error: unknown) {
    if (error instanceof InvalidDateError || error instanceof AnnouncementInputError) {
      return jsonError(error.message, 400);
    }
    logger.error('api.status_page.announcement.create_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to create announcement', 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch (_error) {
      return jsonError('Invalid JSON in request body.', 400);
    }
    const parsed = StatusAnnouncementPatchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid request body.', 400, { issues: parsed.error.issues });
    }
    const {
      statusPageId,
      id,
      title,
      message,
      type,
      startDate,
      endDate,
      isActive,
      affectedServiceIds,
      publishOption,
      publishAt,
      notificationTiming,
    } = parsed.data;
    const normalizedAffectedServiceIds = normalizeAffectedServiceIds(affectedServiceIds);

    const result = await prisma.$transaction(async tx => {
      await lockAnnouncementMutation(tx, statusPageId, id);

      const existing = await tx.statusPageAnnouncement.findFirst({
        where: { id, statusPageId },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          publishAt: true,
          isActive: true,
          notificationTiming: true,
        },
      });
      if (!existing) throw new AnnouncementNotFoundError();

      if (
        affectedServiceIds !== undefined &&
        !(await affectedServicesBelongToPage(statusPageId, normalizedAffectedServiceIds, tx))
      ) {
        throw new AnnouncementInputError('Affected services must belong to this status page.');
      }

      const effectiveStart = startDate ? parseDate(startDate, 'startDate') : existing.startDate;
      const effectiveEnd =
        endDate === undefined ? existing.endDate : endDate ? parseDate(endDate, 'endDate') : null;
      if (effectiveEnd && effectiveEnd <= effectiveStart) {
        throw new AnnouncementInputError('End date must be after start date.');
      }

      let nextPublishAt: Date | undefined;
      if (publishAt) {
        nextPublishAt = parseDate(publishAt, 'publishAt');
      } else if (publishOption === 'AT_START') {
        nextPublishAt = effectiveStart;
      } else if (publishOption === 'NOW') {
        nextPublishAt = new Date();
      }

      const effectivePublishAt = nextPublishAt ?? existing.publishAt;
      if (effectiveEnd && effectivePublishAt > effectiveEnd) {
        throw new AnnouncementInputError('Publish date cannot be after end date.');
      }

      const nextAllDay =
        parsed.data.allDay !== undefined
          ? parsed.data.allDay
          : parsed.data.timeMode !== undefined
            ? parsed.data.timeMode === 'ALL_DAY'
            : undefined;
      const nextTimeMode =
        parsed.data.timeMode !== undefined
          ? parsed.data.timeMode
          : parsed.data.allDay !== undefined
            ? parsed.data.allDay
              ? 'ALL_DAY'
              : 'EXACT'
            : undefined;

      const nextIsActive = isActive !== undefined ? Boolean(isActive) : existing.isActive;
      const timing =
        notificationTiming ??
        ((existing.notificationTiming as AnnouncementNotificationTiming | null) ?? 'NONE');
      const nextPlan = deriveAnnouncementNotificationPlan({
        isActive: nextIsActive,
        notificationTiming: timing,
        publishAt: effectivePublishAt,
        startDate: effectiveStart,
      });

      const schedulingMutation =
        notificationTiming !== undefined ||
        startDate !== undefined ||
        publishAt !== undefined ||
        publishOption !== undefined ||
        isActive !== undefined;
      const generationMutation = schedulingMutation || affectedServiceIds !== undefined;

      const reactivating = existing.isActive === false && nextIsActive === true;
      const enablingNotifications =
        existing.notificationTiming === 'NONE' && timing !== 'NONE';
      if (
        generationMutation &&
        nextPlan.shouldNotify &&
        nextPlan.scheduledAt &&
        nextPlan.scheduledAt.getTime() < Date.now() - 30_000 &&
        publishOption !== 'NOW' &&
        (reactivating || enablingNotifications || schedulingMutation)
      ) {
        throw new AnnouncementInputError(
          'The subscriber notification time is already in the past. Choose Publish now with Notify on publish, choose a future time, or disable subscriber notification.'
        );
      }

      const announcement = await tx.statusPageAnnouncement.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title: title.trim() } : {}),
          ...(message !== undefined ? { message: message.trim() } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(startDate !== undefined ? { startDate: effectiveStart } : {}),
          ...(endDate !== undefined ? { endDate: effectiveEnd } : {}),
          ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
          ...(nextPublishAt !== undefined ? { publishAt: nextPublishAt } : {}),
          ...(notificationTiming !== undefined ? { notificationTiming } : {}),
          ...(nextTimeMode !== undefined ? { timeMode: nextTimeMode } : {}),
          ...(nextAllDay !== undefined ? { allDay: nextAllDay } : {}),
          ...(affectedServiceIds !== undefined
            ? {
                affectedServiceIds:
                  normalizedAffectedServiceIds === null
                    ? Prisma.JsonNull
                    : (normalizedAffectedServiceIds as Prisma.InputJsonValue),
              }
            : {}),
        },
      });

      let generation = await readAnnouncementNotificationGeneration(id, statusPageId, tx);
      if (generation == null) {
        throw new Error('Announcement notification generation is missing');
      }

      if (generationMutation) {
        generation = await incrementAnnouncementNotificationGeneration(id, statusPageId, tx);
        await cancelPendingAnnouncementJobs(tx, id, statusPageId);
        await suppressUndeliveredAnnouncementIntents(
          tx,
          id,
          'Announcement notification policy was superseded by a newer generation.'
        );

        if (nextPlan.shouldNotify && nextPlan.scheduledAt) {
          await createAnnouncementFanoutJob(tx, {
            announcementId: id,
            statusPageId,
            scheduledAt: nextPlan.scheduledAt,
            generation,
          });
        }
      }

      return { announcement, generation };
    });

    logger.info('api.status_page.announcement.updated', {
      announcementId: result.announcement.id,
      notificationGeneration: result.generation,
    });
    return jsonOk({ announcement: result.announcement }, 200);
  } catch (error: unknown) {
    if (error instanceof AnnouncementNotFoundError) {
      return jsonError(error.message, 404);
    }
    if (error instanceof InvalidDateError || error instanceof AnnouncementInputError) {
      return jsonError(error.message, 400);
    }
    logger.error('api.status_page.announcement.update_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to update announcement', 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch (_error) {
      return jsonError('Invalid JSON in request body.', 400);
    }
    const parsed = StatusAnnouncementDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid request body.', 400, { issues: parsed.error.issues });
    }
    const { id, statusPageId } = parsed.data;

    await prisma.$transaction(async tx => {
      await lockAnnouncementMutation(tx, statusPageId, id);
      const existing = await tx.statusPageAnnouncement.findFirst({
        where: { id, statusPageId },
        select: { id: true },
      });
      if (!existing) throw new AnnouncementNotFoundError();

      await incrementAnnouncementNotificationGeneration(id, statusPageId, tx);
      await cancelPendingAnnouncementJobs(tx, id, statusPageId);
      await suppressUndeliveredAnnouncementIntents(
        tx,
        id,
        'Announcement was deleted before provider delivery.'
      );
      await tx.statusPageAnnouncement.delete({ where: { id } });
    });

    logger.info('api.status_page.announcement.deleted', { announcementId: id, statusPageId });
    return jsonOk({ success: true }, 200);
  } catch (error: unknown) {
    if (error instanceof AnnouncementNotFoundError) {
      return jsonError(error.message, 404);
    }
    logger.error('api.status_page.announcement.delete_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to delete announcement', 500);
  }
}
