import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ObjectiveParams } from '@/lib/api-v2/service-objectives';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { readObjectiveSnapshots } from '@/lib/api-v2/service-objective-history';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ,
  scopedFilter: true,
  paramsSchema: ObjectiveParams,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ actor, params, pagination }) => ({
    ...(await readObjectiveSnapshots(
      prisma,
      actor,
      params.id,
      pagination.limit,
      pagination.cursor
    )),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
