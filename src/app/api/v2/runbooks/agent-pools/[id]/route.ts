import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import {
  PoolParams,
  requireRunbookPool,
  projectRunbookPool,
  fleetCommandOptions,
} from '@/lib/api-v2/runbook-pools';
import {
  updateRunbookAgentPool,
  updateRunbookAgentPoolSchema,
  deleteRunbookAgentPool,
} from '@/lib/runbooks/pool-commands';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_READ,
  paramsSchema: PoolParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const pool = await requireRunbookPool(prisma, params.id);
    return {
      data: projectRunbookPool(pool),
      headers: { ...etagHeaders(pool.revision), 'Cache-Control': 'no-store' },
    };
  },
});
export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_POOL_MANAGE,
  paramsSchema: PoolParams,
  querySchema: z.object({}).strict(),
  bodySchema: updateRunbookAgentPoolSchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async context => {
    const pool = await updateRunbookAgentPool(
      context.params.id,
      context.body,
      { id: context.actor.id, apiKeyId: context.apiKey.id },
      { ...fleetCommandOptions(context), expectedRevision: requireRevisionIfMatch(context.req) }
    );
    return {
      data: projectRunbookPool(pool),
      headers: { ...etagHeaders(pool.revision), 'Cache-Control': 'no-store' },
    };
  },
});
export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_POOL_MANAGE,
  paramsSchema: PoolParams,
  querySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async context => {
    await deleteRunbookAgentPool(
      context.params.id,
      { id: context.actor.id, apiKeyId: context.apiKey.id },
      { ...fleetCommandOptions(context), expectedRevision: requireRevisionIfMatch(context.req) }
    );
    return { status: 204 };
  },
});
