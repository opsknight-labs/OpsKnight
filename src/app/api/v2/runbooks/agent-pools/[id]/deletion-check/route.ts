import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { PoolParams, requireRunbookPool } from '@/lib/api-v2/runbook-pools';
import { getRunbookPoolDependencies } from '@/lib/runbooks/pool-commands';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_READ,
  paramsSchema: PoolParams,
  querySchema: z.object({}).strict(),
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ params }) => {
    const pool = await requireRunbookPool(prisma, params.id);
    const dependencies = await getRunbookPoolDependencies(prisma, params.id);
    return {
      data: {
        poolId: pool.id,
        revision: pool.revision,
        canDelete: !Object.values(dependencies).some(Boolean),
        dependencies,
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
