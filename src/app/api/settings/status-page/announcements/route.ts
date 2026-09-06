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
    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
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

    const announcement = await prisma.statusPageAnnouncement.create({
      data: {
        statusPageId,
        title: title.trim(),
        message: message.trim(),
        type: type || 'INFO',
        startDate: parseDate(startDate, 'startDate'),
        endDate: endDate ? parseDate(endDate, 'endDate') : null,
        isActive: isActive !== false,
        affectedServiceIds: normalizedAffectedServiceIds as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    });

    if (notifySubscribers) {
      // Trigger notifications asynchronously
      const { notifyStatusPageSubscribersAnnouncement } =
        await import('@/lib/status-page-notifications');
      // Don't await strictly to ensure fast API response, but in Vercel functions this might need await or execution context.
      // For safety in this environment, we await it or trust the runtime to handle background promises if not awaited.
      // Given the importance, let's await it to ensure it runs before lambda freezes,
      // OR use `waitUntil` if available (Next.js 15+ has `after` or similar).
      // For now, simple await is safest.
      await notifyStatusPageSubscribersAnnouncement(announcement.id, statusPageId);
    }

    logger.info('api.status_page.announcement.created', {
      announcementId: announcement.id,
      notifySubscribers,
    });
    return jsonOk({ announcement }, 200);
  } catch (error: any) {
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
    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
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
      id,
      statusPageId,
      title,
      message,
      type,
      startDate,
      endDate,
      isActive,
      affectedServiceIds,
    } = parsed.data;
    const normalizedAffectedServiceIds = normalizeAffectedServiceIds(affectedServiceIds);

    // Validate ownership - ensure announcement belongs to the specified status page
    const existingAnnouncement = await prisma.statusPageAnnouncement.findUnique({ where: { id } });
    if (!existingAnnouncement || existingAnnouncement.statusPageId !== statusPageId) {
      return jsonError('Announcement not found', 404);
    }

    // If affectedServiceIds are being updated, validate they belong to the same status page
    if (normalizedAffectedServiceIds !== null) {
      const serviceMappings = await prisma.statusPageService.findMany({
        where: { statusPageId, serviceId: { in: normalizedAffectedServiceIds } },
      });
      if (serviceMappings.length !== normalizedAffectedServiceIds.length) {
        return jsonError('One or more affected services do not belong to this status page', 400);
      }
    }

    const updated = await prisma.statusPageAnnouncement.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(message !== undefined ? { message: message.trim() } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(startDate ? { startDate: parseDate(startDate, 'startDate') } : {}),
        ...(endDate !== undefined
          ? { endDate: endDate ? parseDate(endDate, 'endDate') : null }
          : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        ...(affectedServiceIds !== undefined
          ? { affectedServiceIds: normalizedAffectedServiceIds as any }
          : {}),
      },
    });

    logger.info('api.status_page.announcement.updated', { announcementId: updated.id });
    return jsonOk({ announcement: updated }, 200);
  } catch (error: any) {
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
    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
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

    // Validate ownership - ensure announcement belongs to the specified status page
    const existingAnnouncement = await prisma.statusPageAnnouncement.findUnique({ where: { id } });
    if (!existingAnnouncement || existingAnnouncement.statusPageId !== statusPageId) {
      return jsonError('Announcement not found', 404);
    }

    await prisma.statusPageAnnouncement.delete({ where: { id } });

    logger.info('api.status_page.announcement.deleted', { announcementId: id, statusPageId });
    return jsonOk({ success: true }, 200);
  } catch (error: any) {
    logger.error('api.status_page.announcement.delete_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to delete announcement', 500);
  }
}
