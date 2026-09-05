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

function parseDate(value: string, fieldName: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}`);
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
    } = parsed.data;
    const normalizedAffectedServiceIds = normalizeAffectedServiceIds(affectedServiceIds);

    const announcement = await prisma.$transaction(async tx => {
      const created = await tx.statusPageAnnouncement.create({
        data: {
          statusPageId,
          title: title.trim(),
          message: message.trim(),
          type: type || 'INFO',
          startDate: parseDate(startDate, 'startDate'),
          endDate: endDate ? parseDate(endDate, 'endDate') : null,
          isActive: isActive !== false,
          affectedServiceIds:
            normalizedAffectedServiceIds === null
              ? Prisma.JsonNull
              : (normalizedAffectedServiceIds as Prisma.InputJsonValue),
        },
      });
      if (notifySubscribers) {
        await tx.backgroundJob.create({
          data: {
            type: 'STATUS_PAGE_ANNOUNCEMENT_FANOUT',
            status: 'PENDING',
            scheduledAt: new Date(),
            maxAttempts: 5,
            payload: { announcementId: created.id, statusPageId },
          },
        });
      }
      return created;
    });

    logger.info('api.status_page.announcement.created', {
      announcementId: announcement.id,
      notifySubscribers,
    });
    return jsonOk({ announcement }, 200);
  } catch (error: unknown) {
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
    const { id, title, message, type, startDate, endDate, isActive, affectedServiceIds } =
      parsed.data;
    const normalizedAffectedServiceIds = normalizeAffectedServiceIds(affectedServiceIds);
    const existing = await prisma.statusPageAnnouncement.findUnique({
      where: { id },
      select: { startDate: true, endDate: true },
    });
    if (!existing) return jsonError('Announcement not found.', 404);
    const effectiveStart = startDate ? parseDate(startDate, 'startDate') : existing.startDate;
    const effectiveEnd =
      endDate === undefined ? existing.endDate : endDate ? parseDate(endDate, 'endDate') : null;
    if (effectiveEnd && effectiveEnd <= effectiveStart) {
      return jsonError('End date must be after start date.', 400);
    }

    const updated = await prisma.statusPageAnnouncement.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(message !== undefined ? { message: message.trim() } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(startDate ? { startDate: effectiveStart } : {}),
        ...(endDate !== undefined ? { endDate: effectiveEnd } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
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

    logger.info('api.status_page.announcement.updated', { announcementId: updated.id });
    return jsonOk({ announcement: updated }, 200);
  } catch (error: unknown) {
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
    const { id } = parsed.data;

    await prisma.statusPageAnnouncement.delete({ where: { id } });

    logger.info('api.status_page.announcement.deleted', { announcementId: id });
    return jsonOk({ success: true }, 200);
  } catch (error: unknown) {
    logger.error('api.status_page.announcement.delete_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to delete announcement', 500);
  }
}
