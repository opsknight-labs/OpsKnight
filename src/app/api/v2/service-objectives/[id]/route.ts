import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  ObjectiveParams,
  projectObjective,
  objectiveRevision,
  requireReadableObjective,
  requireObjectiveVersion,
} from '@/lib/api-v2/service-objectives';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { updateServiceObjective, strictServiceObjectiveUpdate } from '@/lib/slo/commands';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ,
  scopedFilter: true,
  paramsSchema: ObjectiveParams,
  querySchema: z.object({}).strict(),
  handler: async ({ actor, params }) => {
    const row = await requireReadableObjective(prisma, actor, params.id);
    return {
      data: projectObjective(row),
      headers: { ...etagHeaders(objectiveRevision(row)), 'Cache-Control': 'no-store' },
    };
  },
});
export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_MANAGE,
  paramsSchema: ObjectiveParams,
  querySchema: z.object({}).strict(),
  bodySchema: strictServiceObjectiveUpdate,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx, req }) => {
    const row = await updateServiceObjective(
      tx!,
      params.id,
      body,
      { id: actor.id, source: 'API', apiClientId: apiKey.id },
      requireObjectiveVersion(req)
    );
    return {
      data: projectObjective(row),
      headers: { ...etagHeaders(objectiveRevision(row)), 'Cache-Control': 'no-store' },
    };
  },
});
