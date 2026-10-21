import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { apiV2Error, apiV2Success, authenticateV2Request, buildCursorWhere, enforceV2Authorization, enforceV2RateLimit, formatCursorPagination, parsePaginationParams } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { withV2Observability } from '@/lib/api-v2/observability';

/** Permission-filtered incident operations; untrusted event messages are omitted. */
export const GET = withV2Observability(async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'SEARCH_EXPORT');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    const { limit, cursor } = parsePaginationParams(new URL(req.url).searchParams);
    const cursorWhere = buildCursorWhere(cursor);
    const filters: Prisma.IncidentEventWhereInput[] = [
      { incident: { is: incidentReadWhere(actor) } },
    ];
    if (cursorWhere.OR) filters.push(cursorWhere as Prisma.IncidentEventWhereInput);
    const rows = await prisma.incidentEvent.findMany({
      where: { AND: filters }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, incidentId: true, type: true, createdAt: true,
        incident: { select: { status: true, serviceId: true } },
      },
    });
    const page = formatCursorPagination(rows, limit);
    return apiV2Success(page.data, {
      pagination: page.pagination,
      headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
