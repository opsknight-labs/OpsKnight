import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { apiV2Error, apiV2Success, authenticateV2Request, buildCursorWhere, enforceV2Authorization, enforceV2RateLimit, formatCursorPagination, parsePaginationParams } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

/** Canonical service audit metadata; deployment telemetry has a separate source. */
export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'SEARCH_EXPORT');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.AUDIT_READ);
    const { id } = await params;
    if (!id || id.length > 100) throw new AppError({ code: 'VALIDATION_FAILED' });
    const service = await prisma.service.findFirst({
      where: { AND: [{ id }, serviceReadWhere(actor)] }, select: { id: true },
    });
    if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    const { limit, cursor } = parsePaginationParams(new URL(req.url).searchParams);
    const cursorWhere = buildCursorWhere(cursor);
    const filters: Prisma.AuditLogWhereInput[] = [{ entityType: 'SERVICE', entityId: id }];
    if (cursorWhere.OR) filters.push(cursorWhere as Prisma.AuditLogWhereInput);
    const rows = await prisma.auditLog.findMany({
      where: { AND: filters }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, select: { id: true, action: true, entityId: true, createdAt: true },
    });
    const page = formatCursorPagination(rows, limit);
    return apiV2Success(page.data.map(row => ({ ...row, source: 'AUDIT_LOG' as const })), {
      pagination: page.pagination,
      headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
