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

class InvalidDateError extends Error {
  constructor(public readonly fieldName: string) {
    super(`Invalid ${fieldName}`);
    this.name = 'InvalidDateError';
  }
}

const ISO_DATE_TIME_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseDate(value: string, fieldName: string) {
  if (typeof value !== 'string' || !ISO_DATE_TIME_REGEX.test(value)) {
    throw new InvalidDateError(fieldName);
  }
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

    // Separate concepts: eventStartAt, publishAt, notificationAt
    // Publish NOW -> publishAt = now
    // Publish AT_START -> publishAt = startDate
    const now = new Date();
    let effectivePublishAt = now;
    if (parsed.data.publishAt) {
      effectivePublishAt = parseDate(parsed.data.publishAt, 'publishAt');
    } else if (publishOption === 'AT_START') {
      effectivePublishAt = parsedStartDate;
    }

    // Notify ON_PUBLISH -> job.scheduledAt = publishAt
    // Notify AT_START -> job.scheduledAt = startDate
    // Notify NONE -> no job
    const shouldNotify = notificationTiming !== 'NONE' && notifySubscribers !== false;
    let scheduledNotificationAt = now;
    if (notificationTiming === 'AT_START') {
      scheduledNotificationAt = parsedStartDate;
    } else if (notificationTiming === 'ON_PUBLISH') {
      scheduledNotificationAt = effectivePublishAt;
    }

    const announcement = await prisma.$transaction(async tx => {
      const created = await tx.statusPageAnnouncement.create({
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
          notificationTiming: notificationTiming || 'ON_PUBLISH',
          isActive: isActive !== false,
          affectedServiceIds:
            normalizedAffectedServiceIds === null
              ? Prisma.JsonNull
              : (normalizedAffectedServiceIds as Prisma.InputJsonValue),
        },
      });
      if (shouldNotify && (isActive !== false)) {
        await tx.backgroundJob.create({
          data: {
            type: 'STATUS_PAGE_ANNOUNCEMENT_FANOUT',
            status: 'PENDING',
            scheduledAt: scheduledNotificationAt,
            maxAttempts: 5,
            payload: { announcementId: created.id, statusPageId },
          },
        });
      }
      return created;
    });

    logger.info('api.status_page.announcement.created', {
      announcementId: announcement.id,
      timeMode: effectiveTimeMode,
      publishAt: effectivePublishAt,
      shouldNotify,
      scheduledNotificationAt,
    });
    return jsonOk({ announcement }, 200);
  } catch (error: unknown) {
    if (error instanceof InvalidDateError) {
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
    const existing = await prisma.statusPageAnnouncement.findFirst({
      where: { id, statusPageId },
      select: {
        startDate: true,
        endDate: true,
        publishAt: true,
        isActive: true,
        notificationTiming: true,
      },
    });
    if (!existing) return jsonError('Announcement not found.', 404);
    if (
      affectedServiceIds !== undefined &&
      !(await affectedServicesBelongToPage(statusPageId, normalizedAffectedServiceIds))
    ) {
      return jsonError('Affected services must belong to this status page.', 400);
    }
    const effectiveStart = startDate ? parseDate(startDate, 'startDate') : existing.startDate;
    const effectiveEnd =
      endDate === undefined ? existing.endDate : endDate ? parseDate(endDate, 'endDate') : null;
    if (effectiveEnd && effectiveEnd <= effectiveStart) {
      return jsonError('End date must be after start date.', 400);
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
    if (effectiveEnd && effectivePublishAt && effectivePublishAt > effectiveEnd) {
      return jsonError('Publish date cannot be after end date.', 400);
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
    const effectiveNotificationTiming =
      notificationTiming ?? (existing.notificationTiming as 'ON_PUBLISH' | 'AT_START' | 'NONE') ?? 'ON_PUBLISH';

    const updated = await prisma.$transaction(async tx => {
      // Background fan-out job lifecycle synchronization
      if (nextIsActive === false || effectiveNotificationTiming === 'NONE') {
        // Explicitly deactivated or notifications disabled -> cancel pending notifications
        await tx.$executeRaw`
          DELETE FROM "BackgroundJob"
          WHERE "type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
            AND ("payload"->>'announcementId') = ${id}
            AND ("payload"->>'statusPageId') = ${statusPageId}
            AND "status" = 'PENDING'
        `;
      } else if (
        notificationTiming !== undefined ||
        startDate !== undefined ||
        publishAt !== undefined ||
        publishOption !== undefined ||
        isActive !== undefined
      ) {
        // Timing, active status, or notification configuration modified -> recompute schedule
        let newScheduledAt: Date | null = null;
        if (effectiveNotificationTiming === 'AT_START') {
          newScheduledAt = effectiveStart;
        } else if (effectiveNotificationTiming === 'ON_PUBLISH') {
          newScheduledAt = effectivePublishAt;
        }

        if (newScheduledAt) {
          // Cancel existing pending job and insert updated schedule
          await tx.$executeRaw`
            DELETE FROM "BackgroundJob"
            WHERE "type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
              AND ("payload"->>'announcementId') = ${id}
              AND ("payload"->>'statusPageId') = ${statusPageId}
              AND "status" = 'PENDING'
          `;
          await tx.backgroundJob.create({
            data: {
              type: 'STATUS_PAGE_ANNOUNCEMENT_FANOUT',
              status: 'PENDING',
              scheduledAt: newScheduledAt,
              maxAttempts: 5,
              payload: { announcementId: id, statusPageId },
            },
          });
        }
      }

      return tx.statusPageAnnouncement.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title: title.trim() } : {}),
          ...(message !== undefined ? { message: message.trim() } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(startDate ? { startDate: effectiveStart } : {}),
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
    });

    logger.info('api.status_page.announcement.updated', { announcementId: updated.id });
    return jsonOk({ announcement: updated }, 200);
  } catch (error: unknown) {
    if (error instanceof InvalidDateError) {
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

    const existing = await prisma.statusPageAnnouncement.findFirst({
      where: { id, statusPageId },
      select: { id: true },
    });
    if (!existing) return jsonError('Announcement not found.', 404);

    await prisma.$transaction(async tx => {
      // Cancel pending notifications for deleted announcement scoped by page and announcement
      await tx.$executeRaw`
        DELETE FROM "BackgroundJob"
        WHERE "type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
          AND ("payload"->>'announcementId') = ${id}
          AND ("payload"->>'statusPageId') = ${statusPageId}
          AND "status" = 'PENDING'
      `;
      return tx.statusPageAnnouncement.delete({ where: { id } });
    });

    logger.info('api.status_page.announcement.deleted', { announcementId: id });
    return jsonOk({ success: true }, 200);
  } catch (error: unknown) {
    logger.error('api.status_page.announcement.delete_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to delete announcement', 500);
  }
}
