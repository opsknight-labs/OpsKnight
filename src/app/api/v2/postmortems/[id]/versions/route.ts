import { z } from 'zod';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  beforeRevision: z.coerce.number().int().positive().optional(),
}).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_READ,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema,
  querySchema,
  handler: async ({ params, query, actor }) => {
    const parent = await prisma.postmortem.findFirst({
      where: { AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)] },
      select: { id: true, revision: true },
    });
    if (!parent) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
    const rows = await prisma.postmortemVersion.findMany({
      where: { postmortemId: parent.id, ...(query.beforeRevision ? { revision: { lt: query.beforeRevision } } : {}) },
      orderBy: { revision: 'desc' }, take: query.limit + 1,
      select: { revision: true, createdAt: true, snapshot: true },
    });
    return {
      data: {
        postmortemId: parent.id,
        currentRevision: parent.revision,
        versions: rows.slice(0, query.limit),
        nextBeforeRevision: rows.length > query.limit ? rows[query.limit - 1].revision : null,
      },
      headers: { 'Cache-Control': 'private, no-store' },
    };
  },
});
