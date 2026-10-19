import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { FleetAgentParams, requireFleetAgent, projectFleetAgent } from '@/lib/api-v2/runbook-fleet';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_READ,
  paramsSchema: FleetAgentParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => ({
    data: projectFleetAgent(await requireFleetAgent(prisma, params.id)),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
