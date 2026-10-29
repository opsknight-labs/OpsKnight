import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import {
  objectiveCursor,
  objectivePagination,
  projectObjective,
  objectiveRevision,
} from '@/lib/api-v2/service-objectives';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { createServiceObjective, strictServiceObjectiveCreate } from '@/lib/slo/commands';
import { etagHeaders } from '@/lib/api-v2/concurrency';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ,
  scopedFilter: true,
  querySchema: PaginationQuerySchema.extend({
    serviceId: z.string().cuid().optional(),
  }).strict(),
  handler: async ({ actor, query, pagination }) => {
    const scope = `objectives:${query.serviceId ?? '*'}`;
    const boundary = objectiveCursor(pagination.cursor, scope);
    const rows = await prisma.serviceObjective.findMany({
      where: {
        AND: [
          serviceObjectiveReadWhere(actor),
          {
            ...(query.serviceId ? { serviceId: query.serviceId } : {}),
            activeTo: null,
          },
          ...(boundary
            ? [
                {
                  OR: [
                    { activeFrom: { lt: boundary.at } },
                    { activeFrom: boundary.at, id: { lt: boundary.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ activeFrom: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const result = objectivePagination(rows, pagination.limit, scope, row => row.activeFrom);
    return {
      data: result.data.map(projectObjective),
      pagination: result.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: z
    .object({
      definition: strictServiceObjectiveCreate,
      expectedActiveVersionId: z.string().min(1).max(100).nullable(),
    })
    .strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ body, actor, apiKey, tx }) => {
    const row = await createServiceObjective(
      tx!,
      body.definition,
      { id: actor.id, source: 'API', apiClientId: apiKey.id },
      body.expectedActiveVersionId
    );
    return {
      status: 201,
      data: projectObjective(row),
      headers: {
        ...etagHeaders(objectiveRevision(row)),
        'Cache-Control': 'no-store',
        Location: `/api/v2/service-objectives/${row.lineageId}`,
      },
    };
  },
});
