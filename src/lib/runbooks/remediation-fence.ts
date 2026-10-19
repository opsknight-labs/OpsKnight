import type { Prisma } from '@prisma/client';

const ACTIVE_STATUSES = [
  'QUEUED',
  'RUNNING',
  'WAITING_AGENT',
  'WAITING_APPROVAL',
  'PAUSED',
] as const;

/**
 * Stops further dispatch of automatic remediation. Attempts already in flight keep their
 * unknown outcome through the normal cancellation path; nothing here marks them successful.
 */
export async function fenceAutomaticRemediation(
  tx: Prisma.TransactionClient,
  scope: { incidentId: string } | { bindingId: string; unattendedWritesOnly: true },
  reason: string
): Promise<number> {
  // Narrow transaction doubles in unit tests do not model runbook tables.
  if (!tx.runbookExecution || !tx.backgroundJob) return 0;
  const executions = await tx.runbookExecution.findMany({
    where: {
      triggeredByType: 'TRIGGER',
      status: { in: [...ACTIVE_STATUSES] },
      ...('incidentId' in scope
        ? { incidentId: scope.incidentId }
        : { bindingId: scope.bindingId, unattendedWritesAuthorized: true }),
    },
    select: { id: true },
  });
  if (executions.length === 0) return 0;
  const ids = executions.map(execution => execution.id);
  const stopped = await tx.runbookExecution.updateMany({
    where: { id: { in: ids }, status: { in: [...ACTIVE_STATUSES] } },
    data: { status: 'CANCEL_REQUESTED', cancelRequestedAt: new Date(), failureMessage: reason },
  });
  if (stopped.count === 0) return 0;
  await tx.backgroundJob.createMany({
    data: ids.map(executionId => ({
      type: 'RUNBOOK' as const,
      status: 'PENDING' as const,
      scheduledAt: new Date(),
      maxAttempts: 8,
      payload: { kind: 'ADVANCE_EXECUTION', executionId },
    })),
  });
  return stopped.count;
}
