import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  StatusPageAnnouncementV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.STATUS_PAGE_READ);

    const { id } = await params;
    const page = await prisma.statusPage.findUnique({ where: { id } });
    if (!page) {
      throw new AppError({
        code: 'STATUS_PAGE_NOT_FOUND',
        status: 404,
        userMessage: `Status page with id '${id}' was not found.`,
      });
    }

    const announcements = await prisma.statusPageAnnouncement.findMany({
      where: { statusPageId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        status: true,
        scheduledAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return apiV2Success(announcements, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE);

    const { id } = await params;
    const page = await prisma.statusPage.findUnique({ where: { id } });
    if (!page) {
      throw new AppError({
        code: 'STATUS_PAGE_NOT_FOUND',
        status: 404,
        userMessage: `Status page with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', status: 400, userMessage: 'Invalid JSON request body.' });
    });

    const validated = StatusPageAnnouncementV2Schema.parse(body);

    const announcement = await prisma.statusPageAnnouncement.create({
      data: {
        statusPageId: id,
        title: validated.title,
        message: validated.message,
        type: validated.type,
        status: validated.status,
        scheduledAt: validated.scheduledAt ? new Date(validated.scheduledAt) : null,
      },
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        status: true,
        scheduledAt: true,
        createdAt: true,
      },
    });

    await logV2Audit({
      action: 'status_page_announcement.created',
      entityType: 'STATUS_PAGE',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: {
        announcementId: announcement.id,
        title: announcement.title,
      },
    });

    return apiV2Created(announcement, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
