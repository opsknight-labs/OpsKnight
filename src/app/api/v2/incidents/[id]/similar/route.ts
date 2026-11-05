import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import {
  SIMILAR_DEFAULT_LIMIT,
  SIMILAR_MAX_LIMIT,
  findSimilarIncidents,
} from '@/lib/incident-similar';

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(SIMILAR_MAX_LIMIT).default(SIMILAR_DEFAULT_LIMIT),
  })
  .strict();

/** Past resolved incidents that look like this one, with how each was resolved. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  rateLimitTier: 'SEARCH_EXPORT',
  scopedFilter: true,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema,
  handler: async ({ actor, params, query }) => {
    const readWhere = incidentReadWhere(actor);
    const incident = await prisma.incident.findFirst({
      where: { AND: [{ id: params.id }, readWhere] },
      select: { id: true, title: true, serviceId: true, priority: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const data = await findSimilarIncidents({ incident, readWhere, limit: query.limit });
    return { data, headers: { 'Cache-Control': 'private, no-store' } };
  },
});
