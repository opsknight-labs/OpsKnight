import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  apiV2Error, apiV2Success, authenticateV2Request,
  enforceV2Authorization, enforceV2RateLimit, formatCursorPagination, parsePaginationParams,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';
import { notificationAttemptCursorWhere, notificationAttemptSelect, safeNotificationAttempt } from '@/lib/api-v2/notification-attempts';

/** Delivery metadata only: provider error text and message IDs may contain secrets or PII. */
export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.NOTIFICATION_READ);
    const { id } = await params;
    if (!id || id.length > 100) throw new AppError({ code: 'VALIDATION_FAILED' });
    const notification = await prisma.notification.findUnique({
      where: { id }, select: { id: true },
    });
    if (!notification) throw new AppError({ code: 'NOTIFICATION_NOT_FOUND' });
    const { limit, cursor } = parsePaginationParams(new URL(req.url).searchParams);
    const filters: Prisma.NotificationDeliveryAttemptWhereInput[] = [{ notificationId: id }];
    const cursorWhere = notificationAttemptCursorWhere(cursor);
    if (cursorWhere) filters.push(cursorWhere);
    const rows = await prisma.notificationDeliveryAttempt.findMany({
      where: { AND: filters },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: notificationAttemptSelect,
    });
    // The shared cursor uses createdAt. Attempt rows use startedAt as their stable cursor timestamp.
    const result = formatCursorPagination(rows.map(safeNotificationAttempt), limit);
    return apiV2Success(result.data.map(({ createdAt: _createdAt, ...row }) => row), {
      pagination: result.pagination,
      headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
