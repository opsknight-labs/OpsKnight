import 'server-only';

import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { agentJobResultSchema, type AgentJobResultInput } from './schemas';
import { sha256 } from './agent-auth';
import { redactRunbookOutput } from './redaction';
import { resolveSecretInputValues } from './secrets';
import { DEFAULT_LEASE_DURATION_SECONDS, isSafeToRetryAfterUnknown } from './types';
import {
  RunbookAgentLeaseExpiredError,
  RunbookAgentLeaseTokenMismatchError,
  RunbookAgentNotFoundError,
  RunbookPreExecutionFenceError,
} from './errors';

export async function recordAgentHeartbeat(input: {
  agentId: string;
  hostname?: string;
  version: string;
  platform: string;
  labels?: Record<string, string>;
  capabilities?: string[];
}) {
  const result = await prisma.runbookAgent.updateMany({
    where: { id: input.agentId, status: { not: 'REVOKED' } },
    data: {
      status: 'ONLINE',
      lastHeartbeatAt: new Date(),
      hostname: input.hostname,
      version: input.version,
      platform: input.platform,
      labels: (input.labels ?? {}) as Prisma.InputJsonValue,
      capabilities: (input.capabilities ?? []) as Prisma.InputJsonValue,
    },
  });
  if (result.count !== 1) throw new RunbookAgentNotFoundError(input.agentId);
  return { serverTime: new Date().toISOString() };
}

export async function claimAgentAttempt(agentId: string) {
  return prisma.$transaction(
    async tx => {
      const agent = await tx.runbookAgent.findFirst({
        where: { id: agentId, status: { in: ['ONLINE', 'DEGRADED'] } },
        select: { id: true, capabilities: true },
      });
      if (!agent) throw new RunbookAgentNotFoundError(agentId);
      const attempt = await tx.runbookStepAttempt.findFirst({
        where: {
          status: 'PENDING',
          claimDeadlineAt: { gt: new Date() },
          OR: [
            { agentId },
            {
              agentId: null,
              OR: [{ agentPoolId: null }, { agentPool: { members: { some: { agentId } } } }],
            },
          ],
          executionStep: {
            execution: { status: { in: ['RUNNING', 'WAITING_AGENT'] }, cancelRequestedAt: null },
          },
        },
        orderBy: { createdAt: 'asc' },
        include: {
          executionStep: {
            include: {
              execution: { select: { id: true, inputValues: true, definitionChecksum: true } },
            },
          },
        },
      });
      if (!attempt) return null;
      const rawLeaseToken = crypto.randomBytes(32).toString('base64url');
      const leaseExpiresAt = new Date(Date.now() + DEFAULT_LEASE_DURATION_SECONDS * 1000);
      const claimed = await tx.runbookStepAttempt.updateMany({
        where: { id: attempt.id, status: 'PENDING' },
        data: {
          status: 'CLAIMED',
          agentId,
          leaseToken: sha256(rawLeaseToken),
          leaseExpiresAt,
        },
      });
      if (claimed.count !== 1) return null;
      const resolvedInputValues = await resolveSecretInputValues(
        attempt.executionStep.execution.inputValues as Record<string, unknown>
      );
      return {
        attemptId: attempt.id,
        leaseToken: rawLeaseToken,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        idempotencyKey: attempt.idempotencyKey,
        planDigest: attempt.planDigest,
        executionId: attempt.executionStep.execution.id,
        step: {
          key: attempt.executionStep.stepKey,
          name: attempt.executionStep.name,
          type: attempt.executionStep.type,
          riskClass: attempt.executionStep.riskClass,
          config: attempt.executionStep.config,
          timeoutSeconds: attempt.executionStep.timeoutSeconds,
        },
        inputValues: resolvedInputValues,
      };
    },
    { isolationLevel: 'Serializable' }
  );
}

function leaseHash(token: string): string {
  if (!token || token.length > 512) throw new RunbookAgentLeaseTokenMismatchError('unknown');
  return sha256(token);
}

export async function fenceAgentAttempt(input: {
  attemptId: string;
  agentId: string;
  leaseToken: string;
}) {
  const now = new Date();
  const updated = await prisma.runbookStepAttempt.updateMany({
    where: {
      id: input.attemptId,
      agentId: input.agentId,
      leaseToken: leaseHash(input.leaseToken),
      leaseExpiresAt: { gt: now },
      status: 'CLAIMED',
      executionStep: {
        execution: { cancelRequestedAt: null, status: { in: ['RUNNING', 'WAITING_AGENT'] } },
      },
    },
    data: {
      status: 'RUNNING',
      startedAt: now,
      leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_DURATION_SECONDS * 1000),
    },
  });
  if (updated.count !== 1) {
    throw new RunbookPreExecutionFenceError(
      input.attemptId,
      'lease, cancellation, or execution state changed'
    );
  }
  await prisma.runbookExecutionStep.updateMany({
    where: { attempts: { some: { id: input.attemptId } }, status: 'WAITING_AGENT' },
    data: { status: 'RUNNING' },
  });
  return { startedAt: now.toISOString() };
}

export async function renewAgentAttemptLease(input: {
  attemptId: string;
  agentId: string;
  leaseToken: string;
}) {
  const now = new Date();
  const updated = await prisma.runbookStepAttempt.updateMany({
    where: {
      id: input.attemptId,
      agentId: input.agentId,
      leaseToken: leaseHash(input.leaseToken),
      leaseExpiresAt: { gt: now },
      status: 'RUNNING',
    },
    data: { leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_DURATION_SECONDS * 1000) },
  });
  if (updated.count !== 1) throw new RunbookAgentLeaseExpiredError(input.attemptId, input.agentId);
  return {
    leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_DURATION_SECONDS * 1000).toISOString(),
  };
}

export async function submitAgentResult(agentId: string, raw: AgentJobResultInput) {
  const input = agentJobResultSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const attempt = await tx.runbookStepAttempt.findUnique({
      where: { id: input.attemptId },
      include: { executionStep: { include: { execution: true } } },
    });
    if (!attempt || attempt.agentId !== agentId) throw new RunbookAgentNotFoundError(agentId);
    if (['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(attempt.status)) {
      return { accepted: true, duplicate: true, status: attempt.status };
    }
    if (attempt.leaseToken !== leaseHash(input.leaseToken)) {
      throw new RunbookAgentLeaseTokenMismatchError(input.attemptId);
    }
    if (!attempt.leaseExpiresAt || attempt.leaseExpiresAt <= new Date()) {
      throw new RunbookAgentLeaseExpiredError(input.attemptId, agentId);
    }
    const outputPreview = input.outputPreview
      ? redactRunbookOutput(input.outputPreview)
      : undefined;
    const resultStatus = input.status;
    const retryUnknown =
      resultStatus === 'UNKNOWN' &&
      isSafeToRetryAfterUnknown(attempt.executionStep.riskClass) &&
      attempt.attemptNumber <= attempt.executionStep.maxRetries;
    await tx.runbookStepAttempt.update({
      where: { id: attempt.id },
      data: {
        status: resultStatus,
        completedAt: new Date(),
        exitCode: input.exitCode,
        outputPreview,
        outputArtifactId: input.outputArtifactId,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage ? redactRunbookOutput(input.errorMessage) : undefined,
        preState: input.preState as Prisma.InputJsonValue | undefined,
        postState: input.postState as Prisma.InputJsonValue | undefined,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    if (retryUnknown) {
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
      return { accepted: true, duplicate: false, status: 'RETRYING' };
    }
    const stepStatus =
      resultStatus === 'SUCCEEDED' ? 'SUCCEEDED' : resultStatus === 'FAILED' ? 'FAILED' : 'UNKNOWN';
    await tx.runbookExecutionStep.update({
      where: { id: attempt.executionStepId },
      data: {
        status: stepStatus,
        completedAt: new Date(),
        outputPreview,
        outputArtifactId: input.outputArtifactId,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage ? redactRunbookOutput(input.errorMessage) : undefined,
      },
    });
    await tx.backgroundJob.create({
      data: {
        type: 'RUNBOOK',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 8,
        payload: { kind: 'ADVANCE_EXECUTION', executionId: attempt.executionStep.executionId },
      },
    });
    return { accepted: true, duplicate: false, status: resultStatus };
  });
}
