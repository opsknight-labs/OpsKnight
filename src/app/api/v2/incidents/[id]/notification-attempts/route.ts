import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  apiV2Error, apiV2Success, authenticateV2Request,
  enforceV2Authorization, enforceV2RateLimit, formatCursorPagination, parsePaginationParams,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireIncidentDiagnosticAccess } from '@/lib/api-v2/incident-diagnostics';
import { notificationAttemptCursorWhere, notificationAttemptSelect, safeNotificationAttempt } from '@/lib/api-v2/notification-attempts';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.NOTIFICATION_READ);
    const { id } = await params;
    await requireIncidentDiagnosticAccess(actor, id);
    const { limit, cursor } = parsePaginationParams(new URL(req.url).searchParams);
    const filters: Prisma.NotificationDeliveryAttemptWhereInput[] = [{ notification: { incidentId: id } }];
    const cursorWhere = notificationAttemptCursorWhere(cursor);
    if (cursorWhere) filters.push(cursorWhere);
    const rows = await prisma.notificationDeliveryAttempt.findMany({
      where: { AND: filters },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: limit + 1,
      select: {
        ...notificationAttemptSelect,
        notification: { select: { channel: true, status: true } },
      },
    });
    const page = formatCursorPagination(rows.map(safeNotificationAttempt), limit);
    return apiV2Success(page.data.map(({ createdAt: _createdAt, ...row }) => row), {
      pagination: page.pagination,
      headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
