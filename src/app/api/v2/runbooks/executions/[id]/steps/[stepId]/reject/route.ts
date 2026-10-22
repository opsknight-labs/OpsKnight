import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { rejectExecutionStep } from '@/lib/runbooks/orchestrator';
import {
  ExecutionStepParams,
  StepReview,
  requireExecutionControl,
} from '@/lib/api-v2/runbook-intervention';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_APPROVE,
  paramsSchema: ExecutionStepParams,
  querySchema: z.object({}).strict(),
  bodySchema: StepReview.extend({ reason: z.string().trim().min(1).max(1000) }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ tx, actor, params }) => {
    await requireExecutionControl(tx!, actor, params.id);
  },
  handler: async ({ tx, actor, apiKey, params, body }) => {
    await requireExecutionControl(tx!, actor, params.id);
    await rejectExecutionStep(
      {
        executionId: params.id,
        stepId: params.stepId,
        planDigest: body.planDigest,
        actorId: actor.id,
        reason: body.reason,
      },
      tx,
      { apiClientId: apiKey.id }
    );
    return {
      status: 202,
      data: { executionId: params.id, stepId: params.stepId, status: 'CANCEL_REQUESTED' },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
