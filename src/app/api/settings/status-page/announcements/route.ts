import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { emitAuditEvent, logAudit } from '@/lib/audit';
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
import {
  cancelPendingAnnouncementJobs,
  createAnnouncementFanoutJob,
  lockAnnouncementMutation,
  suppressUndeliveredAnnouncementIntents,
} from '@/lib/status-pages/announcement-commands';
import { AUTO_DRAFT_ID_PREFIX } from '@/lib/business-services/status-page-drafts';

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

async function affectedBusinessServicesBelongToPage(
  statusPageId: string,
  businessServiceIds: string[] | null,
  tx: Pick<typeof prisma, 'statusPageBusinessService'> = prisma
) {
  if (!businessServiceIds?.length) return true;
  const count = await tx.statusPageBusinessService.count({
    where: { statusPageId, businessServiceId: { in: businessServiceIds } },
  });
  return count === businessServiceIds.length;
}

const jsonIds = (ids: string[] | null) =>
  ids === null ? Prisma.JsonNull : (ids as Prisma.InputJsonValue);

function effectiveNotificationTiming(
  notificationTiming: AnnouncementNotificationTiming | undefined,
  notifySubscribers?: boolean
): AnnouncementNotificationTiming {
  if (notifySubscribers === false) return 'NONE';
  return notificationTiming ?? 'ON_PUBLISH';
}

export async function POST(req: NextRequest) {
  let admin: Awaited<ReturnType<typeof assertAdmin>>;
  try {
    admin = await assertAdmin();
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
      incidentId,
      affectedBusinessServiceIds,
    } = parsed.data;
    const normalizedAffectedServiceIds = normalizeAffectedServiceIds(affectedServiceIds);
    const normalizedBusinessServiceIds = normalizeAffectedServiceIds(affectedBusinessServiceIds);

    if (!(await affectedServicesBelongToPage(statusPageId, normalizedAffectedServiceIds))) {
      return jsonError('Affected services must belong to this status page.', 400);
    }
    if (!(await affectedBusinessServicesBelongToPage(statusPageId, normalizedBusinessServiceIds))) {
      return jsonError('Affected business services must be on this status page.', 400);
    }
    // Private incidents never reach a public page (status drafts never offer them either).
    if (
      incidentId &&
      !(await prisma.incident.count({ where: { id: incidentId, visibility: 'PUBLIC' } }))
    ) {
      return jsonError('The linked incident does not exist or is private.', 400);
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
          incidentId: incidentId ?? null,
          affectedServiceIds: jsonIds(normalizedAffectedServiceIds),
          affectedBusinessServiceIds: jsonIds(normalizedBusinessServiceIds),
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
          deliveryMode: 'ALL_ELIGIBLE',
        });
      }
      await logAudit(
        {
          action: 'status_page.announcement.created',
          entityType: 'STATUS_PAGE',
          entityId: statusPageId,
          actorId: admin.id,
          details: {
            announcementId: announcement.id,
            title: announcement.title,
            type: announcement.type,
          },
        },
        tx
      );
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
  let actorId: string;
  try {
    actorId = (await assertAdmin()).id;
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
      affectedBusinessServiceIds,
    } = parsed.data;
    const normalizedAffectedServiceIds = normalizeAffectedServiceIds(affectedServiceIds);
    const normalizedBusinessServiceIds = normalizeAffectedServiceIds(affectedBusinessServiceIds);

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
      if (
        affectedBusinessServiceIds !== undefined &&
        !(await affectedBusinessServicesBelongToPage(
          statusPageId,
          normalizedBusinessServiceIds,
          tx
        ))
      ) {
        throw new AnnouncementInputError('Affected business services must be on this status page.');
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
        (existing.notificationTiming as AnnouncementNotificationTiming | null) ??
        'NONE';
      const nextPlan = deriveAnnouncementNotificationPlan({
        isActive: nextIsActive,
        notificationTiming: timing,
        publishAt: effectivePublishAt,
        startDate: effectiveStart,
      });

      const timingChanged =
        notificationTiming !== undefined && notificationTiming !== existing.notificationTiming;
      const activeChanged = isActive !== undefined && nextIsActive !== existing.isActive;
      const startAffectsNotification = startDate !== undefined && timing === 'AT_START';
      const publishAffectsNotification =
        (publishAt !== undefined || publishOption !== undefined) && timing === 'ON_PUBLISH';
      const eligibilityChanged =
        affectedServiceIds !== undefined || affectedBusinessServiceIds !== undefined;
      const contentMutation =
        title !== undefined ||
        message !== undefined ||
        type !== undefined ||
        startDate !== undefined ||
        endDate !== undefined ||
        parsed.data.timeMode !== undefined ||
        parsed.data.allDay !== undefined;
      const schedulingMutation =
        timingChanged || activeChanged || startAffectsNotification || publishAffectsNotification;
      const generationMutation = schedulingMutation || eligibilityChanged || contentMutation;

      const reactivating = existing.isActive === false && nextIsActive === true;
      const enablingNotifications = existing.notificationTiming === 'NONE' && timing !== 'NONE';
      if (
        schedulingMutation &&
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
            ? { affectedServiceIds: jsonIds(normalizedAffectedServiceIds) }
            : {}),
          ...(affectedBusinessServiceIds !== undefined
            ? { affectedBusinessServiceIds: jsonIds(normalizedBusinessServiceIds) }
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
          'Announcement content or notification policy was superseded by a newer generation.'
        );

        if (nextPlan.shouldNotify && nextPlan.scheduledAt) {
          const now = new Date();
          const scheduledAt =
            nextPlan.scheduledAt.getTime() > now.getTime() ? nextPlan.scheduledAt : now;

          // A replacement generation always continues the campaign for recipients
          // who have not successfully received any prior generation. This removes
          // the coarse "someone was delivered" decision that could create a hole
          // after partial provider acceptance, while preserving accepted mail as
          // historical truth and preventing duplicate blasts.
          await createAnnouncementFanoutJob(tx, {
            announcementId: id,
            statusPageId,
            scheduledAt,
            generation,
            deliveryMode: 'UNDELIVERED_ONLY',
          });
        }
      }

      // Publishing a draft (including one drafted from a business-service status change) is an approval.
      if (!existing.isActive && nextIsActive)
        await emitAuditEvent(
          {
            action: 'status_page.announcement.published',
            source: 'UI',
            actor: { type: 'USER', id: actorId },
            target: { type: 'STATUS_PAGE', id: statusPageId },
            metadata: { announcementId: id, autoDrafted: id.startsWith(AUTO_DRAFT_ID_PREFIX) },
          },
          tx
        );

      await logAudit(
        {
          action: 'status_page.announcement.updated',
          entityType: 'STATUS_PAGE',
          entityId: statusPageId,
          actorId,
          details: { announcementId: id, title: announcement.title },
        },
        tx
      );
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
  let admin: Awaited<ReturnType<typeof assertAdmin>>;
  try {
    admin = await assertAdmin();
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
        select: { id: true, title: true },
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
      await logAudit(
        {
          action: 'status_page.announcement.deleted',
          entityType: 'STATUS_PAGE',
          entityId: statusPageId,
          actorId: admin.id,
          details: { announcementId: id, title: existing.title },
        },
        tx
      );
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
    return jsonError(
      error instanceof Error && error.message ? error.message : 'Failed to delete announcement',
      500
    );
  }
}
