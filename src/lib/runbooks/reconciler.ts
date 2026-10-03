import 'server-only';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { isSafeToRetryAfterUnknown } from './types';

export async function reconcileRunbooks(limit = 100) {
  const now = new Date();
  const expired = await prisma.runbookStepAttempt.findMany({
    where: {
      status: { in: ['CLAIMED', 'RUNNING'] },
      leaseExpiresAt: { lt: now },
    },
    orderBy: { leaseExpiresAt: 'asc' },
    take: limit,
    include: { executionStep: true },
  });
  let reclaimed = 0;
  let unknown = 0;
  for (const attempt of expired) {
    if (attempt.status === 'CLAIMED') {
      const reset = await prisma.runbookStepAttempt.updateMany({
        where: { id: attempt.id, status: 'CLAIMED', leaseExpiresAt: { lt: now } },
        data: {
          status: 'PENDING',
          agentId: null,
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
            agentPoolId: attempt.agentPoolId,
            claimDeadlineAt: new Date(Date.now() + 300_000),
            idempotencyKey: crypto.randomUUID(),
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
  return { inspected: expired.length, reclaimed, unknown, agentsOffline: offline.count };
}
