import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { PoolMemberParams, fleetCommandOptions } from '@/lib/api-v2/runbook-pools';
import { setRunbookPoolMember } from '@/lib/runbooks/pool-commands';
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_POOL_MANAGE,
  paramsSchema: PoolMemberParams,
  querySchema: z.object({}).strict(),
  ...(true ? { bodySchema: z.object({}).strict() } : {}),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async context => {
    const { pool, membership } = await setRunbookPoolMember(
      context.params.id,
      context.params.agentId,
      true,
      { id: context.actor.id, apiKeyId: context.apiKey.id },
      { ...fleetCommandOptions(context), expectedRevision: requireRevisionIfMatch(context.req) }
    );
    return {
      data: {
        poolId: pool.id,
        agentId: context.params.agentId,
        revision: pool.revision,
        membership: membership ? { id: membership.id, source: membership.source } : null,
      },
      headers: { ...etagHeaders(pool.revision), 'Cache-Control': 'no-store' },
    };
  },
});
export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_POOL_MANAGE,
  paramsSchema: PoolMemberParams,
  querySchema: z.object({}).strict(),
  ...(false ? { bodySchema: z.object({}).strict() } : {}),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async context => {
    const { pool, membership } = await setRunbookPoolMember(
      context.params.id,
      context.params.agentId,
      false,
      { id: context.actor.id, apiKeyId: context.apiKey.id },
      { ...fleetCommandOptions(context), expectedRevision: requireRevisionIfMatch(context.req) }
    );
    return {
      data: {
        poolId: pool.id,
        agentId: context.params.agentId,
        revision: pool.revision,
        membership: membership ? { id: membership.id, source: membership.source } : null,
      },
      headers: { ...etagHeaders(pool.revision), 'Cache-Control': 'no-store' },
    };
  },
});
