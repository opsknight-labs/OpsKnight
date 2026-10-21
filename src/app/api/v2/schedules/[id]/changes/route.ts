import { z } from 'zod';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { projectAuditDetails } from '@/lib/api-v2/audit-projection';
import { buildCursorWhere, formatCursorPagination, parsePaginationParams } from '@/lib/api-v2/pagination';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({ limit: z.string().optional(), cursor: z.string().optional() }).strict(),
  handler: async ({ params, query }) => {
    const schedule = await prisma.onCallSchedule.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!schedule) throw new AppError({ code: 'SCHEDULE_NOT_FOUND' });
    const searchParams = new URLSearchParams();
    if (query.limit) searchParams.set('limit', query.limit);
    if (query.cursor) searchParams.set('cursor', query.cursor);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const logs = await prisma.auditLog.findMany({
      where: {
        entityType: 'SCHEDULE', entityId: params.id,
        ...(cursor ? { AND: [buildCursorWhere(cursor)] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, action: true, actorId: true, actorName: true,
        details: true, createdAt: true,
      },
    });
    const result = formatCursorPagination(
      logs.map(log => ({ ...log, details: projectAuditDetails(log.details) })), limit
    );
    return {
      data: result.data,
      pagination: result.pagination,
      headers: { 'Cache-Control': 'private, no-store' },
    };
  },
});
