import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { startRunbookExecution } from '@/lib/runbooks/orchestrator';
import {
  ExecutionParams,
  requireExecutionControl,
  requireRerunRequest,
} from '@/lib/api-v2/runbook-intervention';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
  paramsSchema: ExecutionParams,
  querySchema: z.object({}).strict(),
  bodySchema: z
    .object({
      expectedPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
      previewAuthorizationToken: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ tx, actor, params }) => {
    await requireExecutionControl(tx!, actor, params.id);
  },
  handler: async ({ tx, actor, apiKey, params, body }) => {
    const request = await requireRerunRequest(tx!, actor, params.id);
    const execution = await startRunbookExecution({ ...request, ...body }, tx, {
      apiClientId: apiKey.id,
    });
    return {
      status: 202,
      data: { executionId: execution.id, sourceExecutionId: params.id, status: execution.status },
      headers: {
        'Cache-Control': 'no-store',
        Location: `/api/v2/runbooks/executions/${execution.id}`,
      },
    };
  },
});
