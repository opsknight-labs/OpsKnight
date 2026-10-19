import prisma from '@/lib/prisma';
import { preconditionFailed } from '@/lib/api-v2/concurrency';
import { defineV2Route, RunbookExecuteV2Schema } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { previewRunbookExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';
import { z } from 'zod';
import { resolveV2RunbookExecution } from '@/lib/api-v2/runbook-execution';

export const POST = defineV2Route<{ id: string }, unknown, z.infer<typeof RunbookExecuteV2Schema>>({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: RunbookExecuteV2Schema.strict(),
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: ({ params, body }) =>
    `runbook:execute:${params.id}:${body.incidentId ?? 'global'}`,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const db = tx ?? prisma;
    const { id } = params;
    const resolved = await resolveV2RunbookExecution(db, params, body, actor);
    const resolvedServiceId = resolved.serviceId;

    // 1. Preview execution boundary and generate authorized execution plan
    const preview = await previewRunbookExecution(
      {
        ...resolved,
      },
      tx
    );

    if (body.expectedPlanDigest && body.expectedPlanDigest !== preview.digest) {
      throw preconditionFailed();
    }

    // 2. Start asynchronous execution with preflight digest & preview token
    const execution = await startRunbookExecution(
      {
        ...resolved,
        expectedPlanDigest: preview.digest,
        previewAuthorizationToken: preview.authorizationToken,
      },
      tx,
      { apiClientId: apiKey.id }
    );

    return {
      status: 202,
      data: {
        executionId: execution.id,
        status: execution.status,
        runbookId: id,
        incidentId: body.incidentId ?? null,
        serviceId: resolvedServiceId ?? null,
        message: 'Runbook execution initiated. Poll /api/v2/runbooks/executions/:id for status.',
      },
    };
  },
});
