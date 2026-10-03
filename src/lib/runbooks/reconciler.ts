import 'server-only';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { isSafeToRetryAfterUnknown } from './types';
import { retryDelayMs } from './safety';

export async function reconcileRunbooks(limit = 100) {
  const now = new Date();
  const expired = await prisma.runbookStepAttempt.findMany({
    where: {
      OR: [
        { status: 'PENDING', claimDeadlineAt: { lt: now } },
        { status: { in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: { leaseExpiresAt: 'asc' },
    take: limit,
    include: { executionStep: true },
  });
  let reclaimed = 0;
  let unknown = 0;
  for (const attempt of expired) {
    if (attempt.status === 'PENDING') {
      await prisma.$transaction(async tx => {
        const timedOut = await tx.runbookStepAttempt.updateMany({
          where: { id: attempt.id, status: 'PENDING', claimDeadlineAt: { lt: now } },
          data: {
            status: 'TIMED_OUT',
            completedAt: now,
            errorCode: 'AGENT_CLAIM_TIMEOUT',
            errorMessage: 'No eligible Agent claimed the step before its deadline.',
          },
        });
        if (timedOut.count !== 1) return;
        if (attempt.attemptNumber <= attempt.executionStep.maxRetries) {
          await tx.runbookStepAttempt.create({
            data: {
              executionStepId: attempt.executionStepId,
              attemptNumber: attempt.attemptNumber + 1,
              status: 'PENDING',
              targetAgentId: attempt.targetAgentId,
              targetAgentPoolId: attempt.targetAgentPoolId,
              availableAt: new Date(Date.now() + retryDelayMs(attempt.attemptNumber)),
              claimDeadlineAt: new Date(Date.now() + 300_000),
              idempotencyKey: attempt.idempotencyKey ?? crypto.randomUUID(),
              planDigest: attempt.planDigest,
            },
          });
        } else {
          await tx.runbookExecutionStep.updateMany({
            where: { id: attempt.executionStepId, status: 'WAITING_AGENT' },
            data: {
              status: 'FAILED',
              completedAt: now,
              errorCode: 'AGENT_CLAIM_TIMEOUT',
              errorMessage: 'No eligible Agent was available for this execution target.',
            },
          });
          await tx.backgroundJob.create({
            data: {
              type: 'RUNBOOK',
              status: 'PENDING',
              scheduledAt: now,
              maxAttempts: 8,
              payload: {
                kind: 'ADVANCE_EXECUTION',
                executionId: attempt.executionStep.executionId,
              },
            },
          });
        }
      });
      continue;
    }
    if (attempt.status === 'CLAIMED') {
      const reset = await prisma.runbookStepAttempt.updateMany({
        where: { id: attempt.id, status: 'CLAIMED', leaseExpiresAt: { lt: now } },
        data: {
          status: 'PENDING',
          claimedAgentId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          claimDeadlineAt: new Date(Date.now() + 300_000),
        },
      });
      reclaimed += reset.count;
      continue;
    }
    await prisma.$transaction(async tx => {
      const marked = await tx.runbookStepAttempt.updateMany({
        where: { id: attempt.id, status: 'RUNNING', leaseExpiresAt: { lt: now } },
        data: {
          status: 'UNKNOWN',
          completedAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
          errorCode: 'AGENT_LEASE_EXPIRED',
          errorMessage:
            'Agent disappeared after execution began; the outcome requires verification.',
        },
      });
      if (marked.count !== 1) return;
      const safeRetry =
        isSafeToRetryAfterUnknown(attempt.executionStep.riskClass) &&
        attempt.attemptNumber <= attempt.executionStep.maxRetries;
      if (safeRetry) {
        await tx.runbookStepAttempt.create({
          data: {
            executionStepId: attempt.executionStepId,
            attemptNumber: attempt.attemptNumber + 1,
            status: 'PENDING',
            targetAgentId: attempt.targetAgentId,
            targetAgentPoolId: attempt.targetAgentPoolId,
            availableAt: new Date(Date.now() + retryDelayMs(attempt.attemptNumber)),
            claimDeadlineAt: new Date(Date.now() + 300_000),
            idempotencyKey: attempt.idempotencyKey ?? crypto.randomUUID(),
            planDigest: attempt.planDigest,
          },
        });
        await tx.runbookExecutionStep.update({
          where: { id: attempt.executionStepId },
          data: { status: 'WAITING_AGENT', errorCode: 'UNKNOWN_RETRY_SAFE' },
        });
      } else {
        await tx.runbookExecutionStep.update({
          where: { id: attempt.executionStepId },
          data: {
            status: 'UNKNOWN',
            completedAt: now,
            errorCode: 'UNKNOWN_OUTCOME',
            errorMessage: 'The action may have executed. Verification is required before retrying.',
          },
        });
      }
      await tx.backgroundJob.create({
        data: {
          type: 'RUNBOOK',
          status: 'PENDING',
          scheduledAt: now,
          maxAttempts: 8,
          payload: { kind: 'ADVANCE_EXECUTION', executionId: attempt.executionStep.executionId },
        },
      });
      unknown++;
    });
  }
  const staleAgentCutoff = new Date(Date.now() - 90_000);
  const offline = await prisma.runbookAgent.updateMany({
    where: { status: { in: ['ONLINE', 'DEGRADED'] }, lastHeartbeatAt: { lt: staleAgentCutoff } },
    data: { status: 'OFFLINE' },
  });
  await prisma.runbookAgentRequestNonce.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
  });
  const localRunning = await prisma.runbookExecutionStep.findMany({
    where: {
      status: 'RUNNING',
      type: 'HTTP',
      startedAt: { not: null },
      execution: { status: 'RUNNING', cancelRequestedAt: null },
    },
    orderBy: { startedAt: 'asc' },
    take: limit,
  });
  let localRecovered = 0;
  for (const step of localRunning) {
    const timeoutAt = new Date(
      (step.startedAt?.getTime() ?? now.getTime()) + (step.timeoutSeconds ?? 300) * 1000
    );
    if (timeoutAt >= now) continue;
    await prisma.$transaction(async tx => {
      const safeRetry =
        isSafeToRetryAfterUnknown(step.riskClass) && step.attemptCount <= step.maxRetries;
      const changed = await tx.runbookExecutionStep.updateMany({
        where: { id: step.id, status: 'RUNNING', startedAt: step.startedAt },
        data: safeRetry
          ? {
              status: 'PENDING',
              startedAt: null,
              errorCode: 'LOCAL_STEP_TIMEOUT_RETRY',
              errorMessage: 'The local step timed out and is safe to retry.',
            }
          : {
              status: 'UNKNOWN',
              completedAt: now,
              errorCode: 'LOCAL_STEP_OUTCOME_UNKNOWN',
              errorMessage:
                'The worker disappeared while executing this step; verify the target before retrying.',
            },
      });
      if (changed.count !== 1) return;
      await tx.backgroundJob.create({
        data: {
          type: 'RUNBOOK',
          status: 'PENDING',
          scheduledAt: safeRetry ? new Date(Date.now() + retryDelayMs(step.attemptCount)) : now,
          maxAttempts: 8,
          payload: { kind: 'ADVANCE_EXECUTION', executionId: step.executionId },
        },
      });
      localRecovered++;
    });
  }
  const stranded = await prisma.runbookExecutionStep.findMany({
    where: {
      OR: [
        { status: { in: ['PENDING', 'READY'] } },
        { status: 'RUNNING', type: 'WAIT' },
        {
          status: 'WAITING_AGENT',
          attempts: { none: { status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] } } },
        },
      ],
      execution: { status: { in: ['RUNNING', 'WAITING_AGENT'] } },
    },
    select: { executionId: true },
    distinct: ['executionId'],
    take: limit,
  });
  const cancelled = await prisma.runbookExecution.findMany({
    where: { status: 'CANCEL_REQUESTED' },
    select: { id: true },
    take: limit,
  });
  const recoveryIds = [
    ...new Set([...stranded.map(row => row.executionId), ...cancelled.map(row => row.id)]),
  ];
  if (recoveryIds.length) {
    await prisma.backgroundJob.createMany({
      data: recoveryIds.map(executionId => ({
        type: 'RUNBOOK' as const,
        status: 'PENDING' as const,
        scheduledAt: now,
        maxAttempts: 8,
        payload: { kind: 'RECONCILE_EXECUTION', executionId },
      })),
    });
  }
  return {
    inspected: expired.length,
    reclaimed,
    unknown,
    recovered: recoveryIds.length,
    localRecovered,
    agentsOffline: offline.count,
  };
}
