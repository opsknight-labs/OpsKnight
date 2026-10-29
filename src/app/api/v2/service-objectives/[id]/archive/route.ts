import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  ObjectiveParams,
  projectObjective,
  objectiveRevision,
  requireObjectiveVersion,
} from '@/lib/api-v2/service-objectives';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { archiveServiceObjective } from '@/lib/slo/commands';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_MANAGE,
  paramsSchema: ObjectiveParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, actor, apiKey, tx, req }) => {
    const row = await archiveServiceObjective(
      tx!,
      params.id,
      { id: actor.id, source: 'API', apiClientId: apiKey.id },
      requireObjectiveVersion(req)
    );
    return {
      data: projectObjective(row),
      headers: { ...etagHeaders(objectiveRevision(row)), 'Cache-Control': 'no-store' },
    };
  },
});
