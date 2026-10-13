import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  RunbookExecuteV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  previewRunbookExecution,
  startRunbookExecution,
} from '@/lib/runbooks/orchestrator';
import { AppError } from '@/lib/errors';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE);

    const { id } = await params;
    const runbook = await prisma.runbook.findUnique({
      where: { id },
      select: { id: true, name: true, archivedAt: true, publishedVersionId: true },
    });

    if (!runbook || runbook.archivedAt || !runbook.publishedVersionId) {
      throw new AppError({
        code: 'RUNBOOK_NOT_FOUND',
        userMessage: `Runbook with id '${id}' was not found or is not published.`,
      });
    }

    const body = await req.json().catch(() => ({}));
    const validated = RunbookExecuteV2Schema.parse(body);

    // 1. Preview execution boundary and generate authorized execution plan
    const preview = await previewRunbookExecution({
      runbookId: id,
      incidentId: validated.incidentId ?? undefined,
      triggeredByUserId: actor.id,
      inputValues: validated.parameters,
    });

    // 2. Start asynchronous execution with preflight digest & preview token
    const execution = await startRunbookExecution({
      runbookId: id,
      incidentId: validated.incidentId ?? undefined,
      triggeredByUserId: actor.id,
      inputValues: validated.parameters,
      expectedPlanDigest: preview.digest,
      previewAuthorizationToken: preview.authorizationToken,
    });

    await logV2Audit({
      action: 'runbook.execution_started',
      entityType: 'RUNBOOK',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: {
        executionId: execution.id,
        incidentId: validated.incidentId ?? null,
      },
    });

    const responsePayload = {
      executionId: execution.id,
      status: execution.status,
      runbookId: id,
      incidentId: validated.incidentId ?? null,
      message: 'Runbook execution initiated. Poll /api/v2/runbooks/executions/:id for status.',
    };

    return apiV2Success(responsePayload, { status: 202, headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
