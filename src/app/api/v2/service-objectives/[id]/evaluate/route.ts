import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ObjectiveParams, requireReadableObjective } from '@/lib/api-v2/service-objectives';
import { objectiveEvaluationRequest, requestObjectiveEvaluation } from '@/lib/slo/evaluation-jobs';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_EVALUATE,
  scopedFilter: true,
  paramsSchema: ObjectiveParams,
  querySchema: z.object({}).strict(),
  bodySchema: objectiveEvaluationRequest,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ tx, actor, params, body }) => {
    await requireReadableObjective(tx!, actor, params.id, body.expectedVersionId);
  },
  handler: async ({ tx, actor, apiKey, params, body }) => {
    const job = await requestObjectiveEvaluation(tx!, params.id, body, actor, apiKey.id);
    return {
      status: 202,
      data: job,
      headers: {
        'Cache-Control': 'no-store',
        Location: `/api/v2/service-objectives/${params.id}/evaluations/${job.id}`,
      },
    };
  },
});
