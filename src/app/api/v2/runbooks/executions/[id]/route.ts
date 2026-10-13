import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.RUNBOOK_READ);

    const { id } = await params;
    const execution = await prisma.runbookExecution.findUnique({
      where: { id },
      include: {
        runbook: { select: { id: true, name: true, slug: true } },
        steps: {
          orderBy: { stepIndex: 'asc' },
          select: {
            id: true,
            stepIndex: true,
            title: true,
            actionType: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            error: true,
          },
        },
      },
    });

    if (!execution) {
      throw new AppError({
        code: 'EXECUTION_NOT_FOUND',
        status: 404,
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
      finishedAt: execution.finishedAt,
      steps: execution.steps,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
    };

    return apiV2Success(dto, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
