import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { enforceV2Authorization } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { decodeCursor, formatCursorPagination } from '@/lib/api-v2/pagination';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z
    .object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().max(1000).optional(),
    })
    .strict(),
  handler: async ({ params, actor, pagination }) => {
    // Routing history identifies incidents: both scopes and incident visibility apply.
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    await requireAutomationService(prisma, params.id, actor);
    const access = { serviceId: params.id, incident: incidentReadWhere(actor) };
    let before: { incidentId: string; createdAt: Date } | null = null;
    if (pagination.cursor) {
      const decoded = decodeCursor(pagination.cursor);
      before = await prisma.incidentAutomationDecision.findFirst({
        where: { ...access, incidentId: decoded.id },
        select: { incidentId: true, createdAt: true },
      });
      if (!before || before.createdAt.toISOString() !== decoded.createdAt)
        throw new AppError({ code: 'INVALID_PAGINATION_CURSOR' });
    }
    const rows = await prisma.incidentAutomationDecision.findMany({
      where: {
        ...access,
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, incidentId: { lt: before.incidentId } },
              ],
            }
          : {}),
      },
      select: {
        incidentId: true,
        serviceId: true,
        versionId: true,
        mode: true,
        routeType: true,
        escalationPolicyId: true,
        matchedRouteRuleId: true,
        basePriority: true,
        finalPriority: true,
        evaluationAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { incidentId: 'desc' }],
      take: pagination.limit + 1,
    });
    // Deliberately do not load stored summaries, source values or notification credentials.
    const page = formatCursorPagination(
      rows.map(row => ({ ...row, id: row.incidentId })),
      pagination.limit
    );
    return {
      ...page,
      data: page.data.map(({ id: _id, ...row }) => row),
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
