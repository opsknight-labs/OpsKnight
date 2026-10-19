import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  buildCursorWhere,
  enforceV2Authorization,
  enforceV2RateLimit,
  formatCursorPagination,
  idempotencyResponseHeaders,
  parsePaginationParams,
  runV2IdempotentAuditedMutation,
  StatusPageAnnouncementV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(
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
        userMessage: `Status page with id '${id}' was not found.`,
      });
    }

    // Bounded and cursor-paginated: announcements accumulate over the life of a page.
    const { limit, cursor } = parsePaginationParams(new URL(req.url).searchParams);
    const announcements = await prisma.statusPageAnnouncement.findMany({
      where: {
        AND: [
          { statusPageId: id },
          buildCursorWhere(cursor) as Prisma.StatusPageAnnouncementWhereInput,
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        isActive: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const result = formatCursorPagination(announcements, limit);
    return apiV2Success(result.data, { pagination: result.pagination, headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const POST = withV2Observability(async function POST(
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
        userMessage: `Status page with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = StatusPageAnnouncementV2Schema.parse(body);

    const execution = await runV2IdempotentAuditedMutation(
      req,
      apiKey.id,
      `status-page:${id}:announcement:create`,
      validated,
      tx =>
        tx.statusPageAnnouncement.create({
          data: {
            statusPageId: id,
            title: validated.title,
            message: validated.message,
            type: validated.type,
            startDate: validated.startDate ? new Date(validated.startDate) : new Date(),
            endDate: validated.endDate ? new Date(validated.endDate) : null,
            isActive: validated.isActive,
          },
          select: {
            id: true,
            title: true,
            message: true,
            type: true,
            isActive: true,
            startDate: true,
            endDate: true,
            createdAt: true,
          },
        }),
      announcement => ({
        action: 'status_page_announcement.created',
        entityType: 'STATUS_PAGE',
        entityId: id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: {
          announcementId: announcement.id,
          title: announcement.title,
        },
      })
    );

    const announcement = execution.value;

    return apiV2Created(announcement, {
      headers: { ...rlHeaders, ...idempotencyResponseHeaders(execution.replayed) },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
