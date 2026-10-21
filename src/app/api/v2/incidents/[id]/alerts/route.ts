import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  apiV2Error, apiV2Success, authenticateV2Request, buildCursorWhere,
  enforceV2Authorization, enforceV2RateLimit, formatCursorPagination, parsePaginationParams,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentCorrelationHash, requireIncidentDiagnosticAccess } from '@/lib/api-v2/incident-diagnostics';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    const { id } = await params;
    await requireIncidentDiagnosticAccess(actor, id);
    const { limit, cursor } = parsePaginationParams(new URL(req.url).searchParams);
    const cursorWhere = buildCursorWhere(cursor);
    const filters: Prisma.AlertWhereInput[] = [{ incidentId: id }];
    if (cursorWhere.OR) filters.push(cursorWhere as Prisma.AlertWhereInput);
    const rows = await prisma.alert.findMany({
      where: { AND: filters }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: { id: true, incidentId: true, serviceId: true, status: true, dedupKey: true, createdAt: true },
    });
    const page = formatCursorPagination(rows, limit);
    return apiV2Success(page.data.map(({ dedupKey, ...alert }) => ({
      ...alert,
      correlationHash: dedupKey ? incidentCorrelationHash(dedupKey) : null,
    })), {
      pagination: page.pagination,
      headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
