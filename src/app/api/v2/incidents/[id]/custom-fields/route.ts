import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ params, actor, pagination }) => {
    const incident = await prisma.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const values = await prisma.customFieldValue.findMany({
      where: { AND: [{ incidentId: params.id }, buildCursorWhere(pagination.cursor)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      include: { customField: { select: { name: true, key: true, type: true } } },
    });
    return formatCursorPagination(values, pagination.limit);
  },
});
