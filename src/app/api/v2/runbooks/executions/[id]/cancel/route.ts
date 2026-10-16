import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { cancelExecution } from '@/lib/runbooks/orchestrator';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ reason: z.string().trim().min(1).max(1000) }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const execution = await tx!.runbookExecution.findFirst({
      where: { id: params.id },
      select: {
        id: true,
        incidentId: true,
        triggeredByUserId: true,
        service: { select: { teamId: true } },
      },
    });
    if (!execution) throw new AppError({ code: 'EXECUTION_NOT_FOUND' });
    // Administrators may stop any run. Other operators must own the run or belong
    // to the owning service's team, including for executions with no incident.
    if (
      actor.role !== 'ADMIN' &&
      execution.triggeredByUserId !== actor.id &&
      !(execution.service?.teamId && actor.teamIds.includes(execution.service.teamId))
    ) {
      throw new AppError({ code: 'EXECUTION_NOT_FOUND' });
    }
    if (execution.incidentId) {
      const incident = await tx!.incident.findFirst({
        where: { AND: [{ id: execution.incidentId }, incidentReadWhere(actor)] },
        select: { id: true },
      });
      if (!incident) throw new AppError({ code: 'EXECUTION_NOT_FOUND' });
    }
    await cancelExecution(execution.id, actor.id, body.reason, tx);
    await logV2Audit({
      action: 'runbook.execution.cancel_requested',
      entityType: 'RUNBOOK',
      entityId: execution.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { executionId: execution.id },
      tx,
    });
    return {
      status: 202,
      data: {
        executionId: execution.id,
        status: 'CANCEL_REQUESTED',
        message: 'Cancellation requested. Poll execution status for agent-confirmed completion.',
      },
    };
  },
});
