import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { runbookExecutionReadWhere } from '@/lib/authorization-filters';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';
import { redactRunbookOutput } from '@/lib/runbooks/redaction';

export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.RUNBOOK_READ);

    const { id } = await params;
    const execution = await prisma.runbookExecution.findFirst({
      where: { AND: [{ id }, runbookExecutionReadWhere(actor)] },
      include: {
        runbook: { select: { id: true, name: true, slug: true } },
        steps: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            sequence: true,
            name: true,
            type: true,
            status: true,
            startedAt: true,
            completedAt: true,
            errorCode: true,
            errorMessage: true,
          },
        },
      },
    });

    if (!execution) {
      throw new AppError({
        code: 'EXECUTION_NOT_FOUND',
        userMessage: `Runbook execution with id '${id}' was not found.`,
      });
    }

    const dto = {
      id: execution.id,
      runbookId: execution.runbookId,
      runbook: execution.runbook,
      incidentId: execution.incidentId,
      status: execution.status,
      triggeredByUserId: execution.triggeredByUserId,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      // Defense in depth: agent errors are redacted when stored, but never trust stored text to be
      // free of secrets or unbounded; redact and bound again at the public boundary.
      steps: execution.steps.map(step => ({
        ...step,
        errorMessage: step.errorMessage
          ? redactRunbookOutput(step.errorMessage).slice(0, 2000)
          : step.errorMessage,
      })),
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
    };

    return apiV2Success(dto, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
