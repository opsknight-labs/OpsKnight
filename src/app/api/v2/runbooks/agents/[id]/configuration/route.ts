import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { FleetAgentParams } from '@/lib/api-v2/runbook-fleet';
import { fleetCommandOptions } from '@/lib/api-v2/runbook-pools';
import {
  updateRunbookAgentMetadata,
  updateRunbookAgentMetadataSchema,
} from '@/lib/runbooks/pool-commands';
import { AppError } from '@/lib/errors';
import type { RunbookAgent } from '@prisma/client';
const project = (row: Pick<RunbookAgent, 'id' | 'name' | 'labels' | 'configurationRevision'>) => ({
  id: row.id,
  name: row.name,
  labels: row.labels,
  revision: row.configurationRevision,
});
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_READ,
  paramsSchema: FleetAgentParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const row = await prisma.runbookAgent.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, labels: true, configurationRevision: true },
    });
    if (!row) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Agent not found.' });
    return {
      data: project(row),
      headers: { ...etagHeaders(row.configurationRevision), 'Cache-Control': 'no-store' },
    };
  },
});
export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_MANAGE,
  paramsSchema: FleetAgentParams,
  querySchema: z.object({}).strict(),
  bodySchema: updateRunbookAgentMetadataSchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async context => {
    const row = await updateRunbookAgentMetadata(
      context.params.id,
      context.body,
      { id: context.actor.id, apiKeyId: context.apiKey.id },
      { ...fleetCommandOptions(context), expectedRevision: requireRevisionIfMatch(context.req) }
    );
    return {
      data: project(row),
      headers: { ...etagHeaders(row.configurationRevision), 'Cache-Control': 'no-store' },
    };
  },
});
