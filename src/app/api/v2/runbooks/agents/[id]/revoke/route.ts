import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { FleetAgentParams } from '@/lib/api-v2/runbook-fleet';
import { revokeRunbookAgent } from '@/lib/runbooks/fleet-commands';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_REVOKE,
  paramsSchema: FleetAgentParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ tx, params, actor, apiKey }) => {
    const row = await revokeRunbookAgent(params.id, { id: actor.id, apiKeyId: apiKey.id }, tx);
    return {
      data: { id: row.id, status: row.status, revokedAt: row.revokedAt },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
