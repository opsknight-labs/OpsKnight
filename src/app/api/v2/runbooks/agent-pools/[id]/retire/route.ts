import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { PoolParams, projectRunbookPool } from '@/lib/api-v2/runbook-pools';
import { retireRunbookAgentPool } from '@/lib/runbooks/pool-commands';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_POOL_MANAGE,
  paramsSchema: PoolParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ req, params, actor, apiKey, tx }) => {
    const pool = await retireRunbookAgentPool(
      params.id,
      { id: actor.id, apiKeyId: apiKey.id },
      { client: tx, expectedRevision: requireRevisionIfMatch(req) }
    );
    return {
      data: projectRunbookPool(pool),
      headers: { ...etagHeaders(pool.revision), 'Cache-Control': 'no-store' },
    };
  },
});
