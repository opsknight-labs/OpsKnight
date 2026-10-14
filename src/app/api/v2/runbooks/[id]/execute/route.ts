import prisma from '@/lib/prisma';
import {
  defineV2Route,
  logV2Audit,
  RunbookExecuteV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  previewRunbookExecution,
  startRunbookExecution,
} from '@/lib/runbooks/orchestrator';
import { AppError } from '@/lib/errors';
import type { z } from 'zod';

export const POST = defineV2Route<{ id: string }, any, z.infer<typeof RunbookExecuteV2Schema>>({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
  bodySchema: RunbookExecuteV2Schema,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: ({ params, body }) =>
    `runbook:execute:${params.id}:${body.incidentId ?? 'global'}`,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const db = tx ?? prisma;
    const { id } = params;

    const runbook = await db.runbook.findUnique({
      where: { id },
      select: { id: true, name: true, archivedAt: true, publishedVersionId: true },
    });

    if (!runbook || runbook.archivedAt || !runbook.publishedVersionId) {
      throw new AppError({
        code: 'RUNBOOK_NOT_FOUND',
        userMessage: `Runbook with id '${id}' was not found or is not published.`,
      });
    }

    // 1. Preview execution boundary and generate authorized execution plan
    const preview = await previewRunbookExecution(
      {
        runbookId: id,
        incidentId: body.incidentId ?? undefined,
        triggeredByUserId: actor.id,
        inputValues: body.parameters,
      },
      tx
    );

    // 2. Start asynchronous execution with preflight digest & preview token
    const execution = await startRunbookExecution(
      {
        runbookId: id,
        incidentId: body.incidentId ?? undefined,
        triggeredByUserId: actor.id,
        inputValues: body.parameters,
        expectedPlanDigest: preview.digest,
        previewAuthorizationToken: preview.authorizationToken,
      },
      tx
    );

    await logV2Audit({
      action: 'runbook.execution_started',
      entityType: 'RUNBOOK',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: {
        executionId: execution.id,
        incidentId: body.incidentId ?? null,
      },
      tx,
    });

    return {
      status: 202,
      data: {
        executionId: execution.id,
        status: execution.status,
        runbookId: id,
        incidentId: body.incidentId ?? null,
        message: 'Runbook execution initiated. Poll /api/v2/runbooks/executions/:id for status.',
      },
    };
  },
});
