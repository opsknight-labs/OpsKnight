import 'server-only';

import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { DEFAULT_STEP_TIMEOUT_SECONDS, isSafeToRetryAfterUnknown } from './types';
import { finalizeExecutionDeadline } from './deadline';
import { retryDelayMs } from './safety';
import { lockFleetClaim } from './pool-labels';

function executionPoolIds(targetPoolId: string | null, selection: Prisma.JsonValue) {
  const sourcePoolId =
    selection &&
    typeof selection === 'object' &&
    !Array.isArray(selection) &&
    typeof selection.sourcePoolId === 'string'
      ? selection.sourcePoolId
      : null;
  return [...new Set([targetPoolId, sourcePoolId].filter((id): id is string => id !== null))];
}

async function hasRetiredPool(tx: Prisma.TransactionClient, ids: string[]) {
  if (!ids.length) return false;
  // Preserve assignment/retirement serialization for direct database writers,
  // too. A read of only the explicit target misses selected-Agent provenance.
  const pools = await tx.$queryRaw<Array<{ lifecycle: string }>>(Prisma.sql`
    SELECT lifecycle FROM "RunbookAgentPool" WHERE id IN (${Prisma.join(ids)})
    ORDER BY id FOR SHARE
  `);
  return pools.some(pool => pool.lifecycle === 'RETIRED');
}

async function failRetiredPoolAttempt(tx: Prisma.TransactionClient, id: string, now: Date) {
  const attempt = await tx.runbookStepAttempt.findFirst({
    where: {
      id,
      OR: [{ status: 'PENDING' }, { status: 'CLAIMED', leaseExpiresAt: { lt: now } }],
    },
    select: {
      executionStepId: true,
      targetAgentPoolId: true,
      executionStep: {
        select: { executionId: true, execution: { select: { targetSelection: true } } },
      },
    },
  });
  if (!attempt) return false;
  if (
    !(await hasRetiredPool(
      tx,
      executionPoolIds(attempt.targetAgentPoolId, attempt.executionStep.execution.targetSelection)
    ))
  )
    return false;
  const error = {
    errorCode: 'TARGET_POOL_RETIRED',
    errorMessage: 'The target Agent pool was retired. Select an active target for a new execution.',
  };
  const changed = await tx.runbookStepAttempt.updateMany({
    where: {
      id,
      OR: [{ status: 'PENDING' }, { status: 'CLAIMED', leaseExpiresAt: { lt: now } }],
    },
    data: { status: 'FAILED', completedAt: now, leaseToken: null, leaseExpiresAt: null, ...error },
  });
  if (changed.count !== 1) return false;
  const step = await tx.runbookExecutionStep.updateMany({
    where: { id: attempt.executionStepId, status: { in: ['READY', 'WAITING_AGENT', 'RUNNING'] } },
    data: { status: 'FAILED', completedAt: now, ...error },
  });
  if (step.count === 1)
    await tx.backgroundJob.create({
      data: {
        type: 'RUNBOOK',
        status: 'PENDING',
        scheduledAt: now,
        maxAttempts: 8,
        payload: { kind: 'ADVANCE_EXECUTION', executionId: attempt.executionStep.executionId },
      },
    });
  return true;
}

export async function reconcileRunbooks(limit = 100, connection?: Prisma.TransactionClient) {
  const db = connection ?? prisma;
  const transaction = (callback: (tx: Prisma.TransactionClient) => Promise<void>) =>
    connection ? callback(connection) : prisma.$transaction(callback);
  const now = new Date();
  // Capability records are temporary. Audit events keep issuance/consumption scope and execution IDs.
  const previewRetentionCutoff = new Date(now.getTime() - 30 * 86_400_000);
  const expiredPreviewBatch = await db.runbookPreviewAuthorization.findMany({
    where: { expiresAt: { lt: previewRetentionCutoff } },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: Math.min(1000, Math.max(1, Math.trunc(limit) || 100)),
    select: { id: true },
  });
  const previewAuthorizationsDeleted = expiredPreviewBatch.length
    ? await db.runbookPreviewAuthorization.deleteMany({
        where: {
          id: { in: expiredPreviewBatch.map(record => record.id) },
          expiresAt: { lt: previewRetentionCutoff },
        },
      })
    : { count: 0 };
  const evidenceCutoff = new Date(now.getTime() - 30 * 86400000);
  const oldChecks = await db.runbookPolicyCheck.findMany({
    where: { expiresAt: { lt: evidenceCutoff } },
    take: Math.min(1000, Math.max(1, limit)),
    select: { id: true },
    orderBy: { expiresAt: 'asc' },
  });
  if (oldChecks.length)
    await db.runbookPolicyCheck.deleteMany({
      where: { id: { in: oldChecks.map(check => check.id) }, expiresAt: { lt: evidenceCutoff } },
    });
  const oldWorkers = await db.runtimeWorkerHeartbeat.findMany({
    where: { lastSeenAt: { lt: evidenceCutoff } },
    take: Math.min(1000, Math.max(1, limit)),
    select: { instanceId: true },
    orderBy: { lastSeenAt: 'asc' },
  });
  if (oldWorkers.length)
    await db.runtimeWorkerHeartbeat.deleteMany({
      where: {
        instanceId: { in: oldWorkers.map(worker => worker.instanceId) },
        lastSeenAt: { lt: evidenceCutoff },
      },
    });
  const overdueExecutions = await db.runbookExecution.findMany({
    where: {
      deadlineAt: { lte: now },
      status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
    },
    select: { id: true, incidentId: true },
    orderBy: { deadlineAt: 'asc' },
    take: limit,
  });
  for (const { id: executionId } of overdueExecutions) {
    await transaction(tx => finalizeExecutionDeadline(tx, executionId, now));
  }
  // Retirement prevents new fences. Unstarted work must converge without
  // retrying into a pool whose database assignment guard now rejects it.
  // A live claimed lease is left intact until its holder finishes or expires.
  const retiredTargets = await db.$queryRaw<Array<{ id: string }>>`
    SELECT a.id FROM "RunbookStepAttempt" a
    JOIN "RunbookExecutionStep" s ON s.id = a."executionStepId"
    JOIN "RunbookExecution" e ON e.id = s."executionId"
    WHERE (a.status = 'PENDING' OR (a.status = 'CLAIMED' AND a."leaseExpiresAt" < ${now}))
      AND EXISTS (
        SELECT 1 FROM "RunbookAgentPool" p WHERE p.lifecycle = 'RETIRED'
          AND p.id IN (a."targetAgentPoolId", e."targetSelection"->>'sourcePoolId')
      )
    ORDER BY a."createdAt", a.id LIMIT ${limit}
  `;
  for (const attempt of retiredTargets)
    await transaction(async tx => {
      await lockFleetClaim(tx);
      await failRetiredPoolAttempt(tx, attempt.id, now);
    });
  const expired = await db.runbookStepAttempt.findMany({
    where: {
      OR: [
        { status: 'PENDING', claimDeadlineAt: { lt: now } },
        { status: { in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: { leaseExpiresAt: 'asc' },
    take: limit,
    include: {
      executionStep: {
        include: {
          execution: {
            select: {
              cancelRequestedAt: true,
              status: true,
              deadlineAt: true,
              targetSelection: true,
            },
          },
        },
      },
      targetAgentPool: { select: { mode: true } },
    },
  });
  let reclaimed = 0;
  let unknown = 0;
  for (const attempt of expired) {
    if (attempt.status === 'PENDING') {
      await transaction(async tx => {
        await lockFleetClaim(tx);
        if (await failRetiredPoolAttempt(tx, attempt.id, now)) return;
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
              requiresConfidentialTransport: attempt.requiresConfidentialTransport,
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
      const reset = await db.runbookStepAttempt.updateMany({
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
    if (
      attempt.executionStep.execution.cancelRequestedAt ||
      attempt.executionStep.execution.status === 'CANCEL_REQUESTED'
    ) {
      await transaction(async tx => {
        const isWrite = attempt.executionStep.riskClass !== 'READ_ONLY';
        const cancelled = await tx.runbookStepAttempt.updateMany({
          where: { id: attempt.id, status: 'RUNNING', leaseExpiresAt: { lt: now } },
          data: {
            status: isWrite ? 'UNKNOWN' : 'CANCELLED',
            completedAt: now,
            leaseToken: isWrite ? attempt.leaseToken : null,
            leaseExpiresAt: isWrite ? attempt.leaseExpiresAt : null,
            errorCode: isWrite ? 'CANCEL_ACK_TIMEOUT_UNKNOWN' : 'CANCEL_ACK_TIMEOUT',
            errorMessage: isWrite
              ? 'The Agent was executing a write when cancellation was requested and its lease expired without acknowledgement; physical outcome is unknown.'
              : 'The Agent did not acknowledge cancellation before its lease expired.',
          },
        });
        if (cancelled.count !== 1) return;
        await tx.runbookExecutionStep.updateMany({
          where: { id: attempt.executionStepId, status: { in: ['RUNNING', 'WAITING_AGENT'] } },
          data: {
            status: isWrite ? 'UNKNOWN' : 'CANCELLED',
            completedAt: now,
            errorCode: isWrite ? 'CANCEL_ACK_TIMEOUT_UNKNOWN' : 'CANCEL_ACK_TIMEOUT',
            errorMessage: isWrite
              ? 'The Agent was executing a write when cancellation was requested and its lease expired without acknowledgement; physical outcome is unknown.'
              : 'The Agent did not acknowledge cancellation before its lease expired.',
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
      });
      continue;
    }
    await transaction(async tx => {
      await lockFleetClaim(tx);
      const retiredPool = await hasRetiredPool(
        tx,
        executionPoolIds(attempt.targetAgentPoolId, attempt.executionStep.execution.targetSelection)
      );
      const marked = await tx.runbookStepAttempt.updateMany({
        where: { id: attempt.id, status: 'RUNNING', leaseExpiresAt: { lt: now } },
        data: {
          status: 'UNKNOWN',
          completedAt: now,
          errorCode: 'AGENT_LEASE_EXPIRED',
          errorMessage:
            'Agent disappeared after execution began; the outcome requires verification.',
        },
      });
      if (marked.count !== 1) return;
      const safeRetry =
        !retiredPool &&
        isSafeToRetryAfterUnknown(attempt.executionStep.riskClass) &&
        !attempt.executionStep.execution.cancelRequestedAt &&
        attempt.executionStep.execution.deadlineAt > now &&
        ['RUNNING', 'WAITING_AGENT'].includes(attempt.executionStep.execution.status) &&
        attempt.attemptNumber <= attempt.executionStep.maxRetries;
      if (safeRetry) {
        const localHostRetry = attempt.targetAgentPool?.mode === 'LOCAL_HOSTS';
        await tx.runbookStepAttempt.create({
          data: {
            executionStepId: attempt.executionStepId,
            attemptNumber: attempt.attemptNumber + 1,
            status: 'PENDING',
            requiresConfidentialTransport: attempt.requiresConfidentialTransport,
            targetAgentId: localHostRetry ? attempt.claimedAgentId : attempt.targetAgentId,
            targetAgentPoolId: localHostRetry ? null : attempt.targetAgentPoolId,
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
  const offline = await db.runbookAgent.updateMany({
    where: { status: { in: ['ONLINE', 'DEGRADED'] }, lastHeartbeatAt: { lt: staleAgentCutoff } },
    data: { status: 'OFFLINE' },
  });
  const localRunning = await db.runbookExecutionStep.findMany({
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
      (step.startedAt?.getTime() ?? now.getTime()) +
        (step.timeoutSeconds ?? DEFAULT_STEP_TIMEOUT_SECONDS) * 1000
    );
    if (timeoutAt >= now) continue;
    await transaction(async tx => {
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
  const stranded = await db.runbookExecutionStep.findMany({
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
  const cancelled = await db.runbookExecution.findMany({
    where: { status: 'CANCEL_REQUESTED' },
    select: { id: true },
    take: limit,
  });
  const recoveryIds = [
    ...new Set([...stranded.map(row => row.executionId), ...cancelled.map(row => row.id)]),
  ];
  if (recoveryIds.length) {
    for (const executionId of recoveryIds) {
      const recoveryJobId = `runbook-recovery:${executionId}`;
      const payload = JSON.stringify({ kind: 'RECONCILE_EXECUTION', executionId });
      await db.$executeRaw`
        INSERT INTO "BackgroundJob" (id, type, status, "scheduledAt", "maxAttempts", payload, "updatedAt")
        VALUES (${recoveryJobId}, 'RUNBOOK', 'PENDING', ${now}, 8, ${payload}::jsonb, ${now})
        ON CONFLICT (id) DO UPDATE SET status = 'PENDING', "scheduledAt" = EXCLUDED."scheduledAt",
          attempts = 0, "startedAt" = NULL, "completedAt" = NULL, "failedAt" = NULL, error = NULL, "updatedAt" = EXCLUDED."updatedAt"
        WHERE "BackgroundJob".status IN ('COMPLETED', 'FAILED', 'CANCELLED')`;
    }
  }
  return {
    inspected: expired.length,
    timedOutExecutions: overdueExecutions.length,
    reclaimed,
    unknown,
    recovered: recoveryIds.length,
    localRecovered,
    agentsOffline: offline.count,
    previewAuthorizationsDeleted: previewAuthorizationsDeleted.count,
  };
}
