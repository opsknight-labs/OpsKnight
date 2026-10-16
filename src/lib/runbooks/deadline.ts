import 'server-only';
import type { Prisma } from '@prisma/client';
import { finalizeVerificationEvidence } from './verification-evidence';

/** Stop new work at the deadline, retaining fenced in-flight attempts until their outcome is known. */
export async function finalizeExecutionDeadline(
  tx: Prisma.TransactionClient,
  executionId: string,
  now = new Date()
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runbook-deadline:${executionId}`}))`;
  const execution = await tx.runbookExecution.findUnique({
    where: { id: executionId },
    select: { id: true, incidentId: true, deadlineAt: true, status: true },
  });
  if (
    !execution ||
    execution.deadlineAt > now ||
    ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'CANCEL_REQUESTED'].includes(execution.status)
  )
    return;
  await tx.runbookStepAttempt.updateMany({
    where: {
      executionStep: { executionId },
      status: { in: ['PENDING', 'CLAIMED'] },
    },
    data: {
      status: 'TIMED_OUT',
      completedAt: now,
      errorCode: 'EXECUTION_TIMEOUT',
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  await tx.runbookExecutionStep.updateMany({
    where: {
      executionId,
      status: { in: ['PENDING', 'READY', 'WAITING_APPROVAL', 'WAITING_AGENT'] },
    },
    data: { status: 'CANCELLED', completedAt: now, errorCode: 'EXECUTION_TIMEOUT' },
  });
  await tx.runbookExecutionStep.updateMany({
    where: {
      executionId,
      type: 'WAIT',
      status: 'RUNNING',
    },
    data: { status: 'CANCELLED', completedAt: now, errorCode: 'EXECUTION_TIMEOUT' },
  });
  await tx.runbookExecutionStep.updateMany({
    where: {
      executionId,
      type: 'HTTP',
      status: 'RUNNING',
      riskClass: 'READ_ONLY',
    },
    data: { status: 'CANCELLED', completedAt: now, errorCode: 'EXECUTION_TIMEOUT' },
  });
  await tx.runbookExecutionStep.updateMany({
    where: {
      executionId,
      type: 'HTTP',
      status: 'RUNNING',
      riskClass: { not: 'READ_ONLY' },
    },
    data: {
      status: 'UNKNOWN',
      completedAt: now,
      errorCode: 'TIMED_OUT_WITH_UNKNOWN_OUTCOME',
      outputPreview:
        'Execution timed out while HTTP write operation was in flight; outcome is unknown.',
    },
  });
  await tx.runbookExecutionStep.updateMany({
    where: {
      executionId,
      status: 'RUNNING',
      type: {
        notIn: ['HTTP', 'WAIT', 'LINUX_DIAGNOSTICS', 'SYSTEMD', 'DOCKER', 'KUBERNETES', 'BASH'],
      },
    },
    data: { status: 'CANCELLED', completedAt: now, errorCode: 'EXECUTION_TIMEOUT' },
  });
  const active = await tx.runbookStepAttempt.count({
    where: { executionStep: { executionId }, status: 'RUNNING' },
  });
  if (active === 0) {
    const hasUnknown = await tx.runbookExecutionStep.count({
      where: { executionId, status: 'UNKNOWN' },
    });
    if (hasUnknown > 0) {
      const failed = await tx.runbookExecution.updateMany({
        where: {
          id: executionId,
          status: { notIn: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'CANCEL_REQUESTED'] },
        },
        data: {
          status: 'FAILED',
          completedAt: now,
          failureCode: 'UNKNOWN_OUTCOME',
          failureMessage:
            'Execution timed out while one or more write steps had unverified outcomes.',
        },
      });
      if (failed.count === 1) {
        await addIncidentRunbookEvent(
          tx,
          execution.incidentId,
          'RUNBOOK_FAILED',
          'Runbook execution timed out with an unverified write outcome.'
        );
        await finalizeVerificationEvidence(tx, executionId);
      }
    } else {
      const timedOut = await tx.runbookExecution.updateMany({
        where: {
          id: executionId,
          status: { notIn: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'CANCEL_REQUESTED'] },
        },
        data: {
          status: 'TIMED_OUT',
          completedAt: now,
          failureCode: 'EXECUTION_TIMEOUT',
        },
      });
      if (timedOut.count === 1) {
        await addIncidentRunbookEvent(
          tx,
          execution.incidentId,
          'RUNBOOK_FAILED',
          'Runbook execution timed out.'
        );
        await finalizeVerificationEvidence(tx, executionId);
      }
    }
  }
}

async function addIncidentRunbookEvent(
  tx: Prisma.TransactionClient,
  incidentId: string | null,
  type: 'RUNBOOK_FAILED',
  message: string
) {
  if (incidentId) await tx.incidentEvent.create({ data: { incidentId, type, message } });
}
