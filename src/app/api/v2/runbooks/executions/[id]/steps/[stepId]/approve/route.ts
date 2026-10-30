import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { approveExecutionStep } from '@/lib/runbooks/orchestrator';
import {
  ExecutionStepParams,
  StepReview,
  requireExecutionControl,
} from '@/lib/api-v2/runbook-intervention';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_APPROVE,
  paramsSchema: ExecutionStepParams,
  querySchema: z.object({}).strict(),
  bodySchema: StepReview,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ tx, actor, params }) => {
    await requireExecutionControl(tx!, actor, params.id);
  },
  handler: async ({ tx, actor, apiKey, params, body }) => {
    await requireExecutionControl(tx!, actor, params.id);
    await approveExecutionStep(
      {
        executionId: params.id,
        stepId: params.stepId,
        planDigest: body.planDigest,
        actorId: actor.id,
      },
      tx,
      { apiClientId: apiKey.id }
    );
    return {
      status: 202,
      data: { executionId: params.id, stepId: params.stepId, status: 'APPROVED' },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
