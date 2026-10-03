import 'server-only';

import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  agentArtifactSchema,
  agentJobResultSchema,
  type AgentArtifactInput,
  type AgentJobResultInput,
} from './schemas';
import { sha256 } from './agent-auth';
import { redactRunbookOutput } from './redaction';
import { resolveSecretInputValues } from './secrets';
import { isSecretReference } from './definition';
import { DEFAULT_LEASE_DURATION_SECONDS, isRetryable, isSafeToRetryAfterUnknown } from './types';
import { agentSupportsStep, retryDelayMs } from './safety';
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
  policyHash?: string;
  spoolDepth?: number;
  activeAttemptCount?: number;
  lastError?: string | null;
}) {
  const result = await prisma.runbookAgent.updateMany({
    where: { id: input.agentId, status: { not: 'REVOKED' } },
    data: {
      status: input.lastError || (input.spoolDepth ?? 0) > 0 ? 'DEGRADED' : 'ONLINE',
      lastHeartbeatAt: new Date(),
      hostname: input.hostname,
      version: input.version,
      platform: input.platform,
      labels: (input.labels ?? {}) as Prisma.InputJsonValue,
      capabilities: (input.capabilities ?? []) as Prisma.InputJsonValue,
      policyHash: input.policyHash,
      spoolDepth: input.spoolDepth,
      activeAttemptCount: input.activeAttemptCount,
      lastError: input.lastError,
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
      const candidates = await tx.runbookStepAttempt.findMany({
        where: {
          status: 'PENDING',
          availableAt: { lte: new Date() },
          claimDeadlineAt: { gt: new Date() },
          OR: [
            { targetAgentId: agentId },
            {
              targetAgentId: null,
              targetAgentPool: { members: { some: { agentId } } },
            },
          ],
          executionStep: {
            execution: { status: { in: ['RUNNING', 'WAITING_AGENT'] }, cancelRequestedAt: null },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        include: {
          targetAgentPool: { select: { mode: true } },
          executionStep: {
            include: {
              execution: { select: { id: true, inputValues: true, definitionChecksum: true } },
            },
          },
        },
      });
      const capabilities = Array.isArray(agent.capabilities)
        ? agent.capabilities.filter((value): value is string => typeof value === 'string')
        : [];
      const attempt = candidates.find(candidate => {
        return agentSupportsStep(capabilities, candidate.executionStep.type);
      });
      if (!attempt) return null;
      const rawLeaseToken = crypto.randomBytes(32).toString('base64url');
      const leaseExpiresAt = new Date(Date.now() + DEFAULT_LEASE_DURATION_SECONDS * 1000);
      const claimed = await tx.runbookStepAttempt.updateMany({
        where: { id: attempt.id, status: 'PENDING' },
        data: {
          status: 'CLAIMED',
          claimedAgentId: agentId,
          leaseToken: sha256(rawLeaseToken),
          leaseExpiresAt,
        },
      });
      if (claimed.count !== 1) return null;
      const rawInputValues = attempt.executionStep.execution.inputValues as Record<string, unknown>;
      const resolvedInputValues = await resolveSecretInputValues(
        rawInputValues,
        { agentId, targetAgentPoolId: attempt.targetAgentPoolId },
        tx
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
        secretInputKeys: Object.entries(rawInputValues)
          .filter(([, value]) => isSecretReference(value))
          .map(([key]) => key),
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
      claimedAgentId: input.agentId,
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
  const attempt = await prisma.runbookStepAttempt.findFirst({
    where: {
      id: input.attemptId,
      claimedAgentId: input.agentId,
      leaseToken: leaseHash(input.leaseToken),
      leaseExpiresAt: { gt: now },
      status: 'RUNNING',
    },
    select: {
      executionStep: {
        select: { execution: { select: { cancelRequestedAt: true, status: true } } },
      },
    },
  });
  if (!attempt) throw new RunbookAgentLeaseExpiredError(input.attemptId, input.agentId);
  if (
    attempt.executionStep.execution.cancelRequestedAt ||
    attempt.executionStep.execution.status === 'CANCEL_REQUESTED'
  ) {
    const acknowledgementDeadline = new Date(now.getTime() + 30_000);
    const updated = await prisma.runbookStepAttempt.updateMany({
      where: {
        id: input.attemptId,
        claimedAgentId: input.agentId,
        leaseToken: leaseHash(input.leaseToken),
        leaseExpiresAt: { gt: now },
        status: 'RUNNING',
      },
      data: { leaseExpiresAt: acknowledgementDeadline },
    });
    if (updated.count !== 1)
      throw new RunbookAgentLeaseExpiredError(input.attemptId, input.agentId);
    return { leaseExpiresAt: acknowledgementDeadline.toISOString(), cancelRequested: true };
  }
  const updated = await prisma.runbookStepAttempt.updateMany({
    where: {
      id: input.attemptId,
      claimedAgentId: input.agentId,
      leaseToken: leaseHash(input.leaseToken),
      leaseExpiresAt: { gt: now },
      status: 'RUNNING',
    },
    data: { leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_DURATION_SECONDS * 1000) },
  });
  if (updated.count !== 1) throw new RunbookAgentLeaseExpiredError(input.attemptId, input.agentId);
  return {
    leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_DURATION_SECONDS * 1000).toISOString(),
    cancelRequested: false,
  };
}

export async function submitAgentResult(agentId: string, raw: AgentJobResultInput) {
  const input = agentJobResultSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const attempt = await tx.runbookStepAttempt.findUnique({
      where: { id: input.attemptId },
      include: {
        targetAgentPool: { select: { mode: true } },
        executionStep: { include: { execution: true } },
      },
    });
    if (!attempt || attempt.claimedAgentId !== agentId)
      throw new RunbookAgentNotFoundError(agentId);
    if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN'].includes(attempt.status)) {
      return { accepted: true, duplicate: true, status: attempt.status };
    }
    const cancellationRequested =
      Boolean(attempt.executionStep.execution.cancelRequestedAt) ||
      attempt.executionStep.execution.status === 'CANCEL_REQUESTED';
    if (
      attempt.status !== 'RUNNING' ||
      attempt.executionStep.execution.status === 'CANCELLED' ||
      (cancellationRequested && input.status !== 'CANCELLED') ||
      (!cancellationRequested && input.status === 'CANCELLED')
    ) {
      throw new RunbookPreExecutionFenceError(
        input.attemptId,
        'result requires a RUNNING attempt on a non-cancelled execution'
      );
    }
    if (attempt.leaseToken !== leaseHash(input.leaseToken)) {
      throw new RunbookAgentLeaseTokenMismatchError(input.attemptId);
    }
    if (!attempt.leaseExpiresAt || attempt.leaseExpiresAt <= new Date()) {
      throw new RunbookAgentLeaseExpiredError(input.attemptId, agentId);
    }
    if (input.outputArtifactId) {
      const artifact = await tx.runbookArtifact.findFirst({
        where: { id: input.outputArtifactId, attemptId: attempt.id },
        select: { id: true },
      });
      if (!artifact) {
        throw new RunbookPreExecutionFenceError(
          input.attemptId,
          'output artifact is not owned by attempt'
        );
      }
    }
    const outputPreview = input.outputPreview
      ? redactRunbookOutput(input.outputPreview)
      : undefined;
    const resultStatus = input.status;
    const retryUnknown =
      resultStatus === 'UNKNOWN' && isSafeToRetryAfterUnknown(attempt.executionStep.riskClass);
    const retryFailed = resultStatus === 'FAILED' && isRetryable(attempt.executionStep.riskClass);
    const shouldRetry =
      (retryUnknown || retryFailed) && attempt.attemptNumber <= attempt.executionStep.maxRetries;
    const completed = await tx.runbookStepAttempt.updateMany({
      where: { id: attempt.id, status: 'RUNNING', claimedAgentId: agentId },
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
    if (completed.count !== 1) {
      throw new RunbookPreExecutionFenceError(input.attemptId, 'attempt state changed');
    }
    if (shouldRetry) {
      const localHostRetry = attempt.targetAgentPool?.mode === 'LOCAL_HOSTS';
      await tx.runbookStepAttempt.create({
        data: {
          executionStepId: attempt.executionStepId,
          attemptNumber: attempt.attemptNumber + 1,
          status: 'PENDING',
          targetAgentId: localHostRetry ? agentId : attempt.targetAgentId,
          targetAgentPoolId: localHostRetry ? null : attempt.targetAgentPoolId,
          availableAt: new Date(Date.now() + retryDelayMs(attempt.attemptNumber)),
          claimDeadlineAt: new Date(Date.now() + 300_000),
          idempotencyKey: attempt.idempotencyKey ?? crypto.randomUUID(),
          planDigest: attempt.planDigest,
        },
      });
      await tx.runbookExecutionStep.update({
        where: { id: attempt.executionStepId },
        data: {
          status: 'WAITING_AGENT',
          errorCode: retryUnknown ? 'UNKNOWN_RETRY_SAFE' : 'FAILED_RETRY_SCHEDULED',
        },
      });
      return { accepted: true, duplicate: false, status: 'RETRYING' };
    }
    const stepStatus =
      resultStatus === 'SUCCEEDED'
        ? 'SUCCEEDED'
        : resultStatus === 'FAILED'
          ? 'FAILED'
          : resultStatus === 'CANCELLED'
            ? 'CANCELLED'
            : 'UNKNOWN';
    const stepUpdated = await tx.runbookExecutionStep.updateMany({
      where: { id: attempt.executionStepId, status: 'RUNNING' },
      data: {
        status: stepStatus,
        completedAt: new Date(),
        outputPreview,
        outputArtifactId: input.outputArtifactId,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage ? redactRunbookOutput(input.errorMessage) : undefined,
      },
    });
    if (stepUpdated.count !== 1) {
      throw new RunbookPreExecutionFenceError(input.attemptId, 'execution step state changed');
    }
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

export async function storeAgentArtifact(agentId: string, raw: AgentArtifactInput) {
  const input = agentArtifactSchema.parse(raw);
  const content = Buffer.from(input.contentBase64, 'base64');
  if (content.length === 0 || content.length > 1_048_576) {
    throw new Error('Compressed artifact must be between 1 byte and 1 MiB.');
  }
  if (sha256(content) !== input.sha256) throw new Error('Artifact checksum does not match.');
  return prisma.$transaction(async tx => {
    const attempt = await tx.runbookStepAttempt.findFirst({
      where: {
        id: input.attemptId,
        claimedAgentId: agentId,
        status: 'RUNNING',
        leaseToken: leaseHash(input.leaseToken),
        leaseExpiresAt: { gt: new Date() },
        executionStep: { execution: { cancelRequestedAt: null } },
      },
      select: { id: true },
    });
    if (!attempt) {
      throw new RunbookPreExecutionFenceError(
        input.attemptId,
        'artifact requires an active fenced attempt'
      );
    }
    return tx.runbookArtifact.create({
      data: {
        attemptId: attempt.id,
        kind: input.kind,
        mediaType: input.mediaType,
        encoding: input.encoding,
        sizeBytes: content.length,
        sha256: input.sha256,
        content,
        truncated: input.truncated,
      },
      select: { id: true, sizeBytes: true, sha256: true },
    });
  });
}
