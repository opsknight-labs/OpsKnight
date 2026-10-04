import 'server-only';

import crypto from 'crypto';
import { Prisma, type RunbookStepType } from '@prisma/client';
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
import {
  isSecretReference,
  referencedStepInputKeys,
  resolveInputTemplates,
  validateResolvedStepConfig,
} from './definition';
import { DEFAULT_LEASE_DURATION_SECONDS, isRetryable, isSafeToRetryAfterUnknown } from './types';
import { agentSupportsStep, isRetryableFailure, retryDelayMs } from './safety';
import { signExecutionEnvelope } from './execution-signing';
import {
  RunbookAgentLeaseExpiredError,
  RunbookDefinitionError,
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
  capabilityReport?: {
    name: string;
    type: string;
    configured: boolean;
    available: boolean;
    reason: string | null;
  }[];
  trustedSigningKeys?: string[];
  policyHash?: string;
  spoolDepth?: number;
  deadLetterDepth?: number;
  activeAttemptCount?: number;
  lastError?: string | null;
}) {
  const result = await prisma.runbookAgent.updateMany({
    where: { id: input.agentId, status: { not: 'REVOKED' } },
    data: {
      status:
        input.lastError || (input.spoolDepth ?? 0) > 0 || (input.deadLetterDepth ?? 0) > 0
          ? 'DEGRADED'
          : 'ONLINE',
      lastHeartbeatAt: new Date(),
      hostname: input.hostname,
      version: input.version,
      platform: input.platform,
      // Scheduling labels are administrator-owned; heartbeat must not self-grant pool secrets.
      capabilities: (input.capabilities ?? []) as Prisma.InputJsonValue,
      capabilityReport: input.capabilityReport as Prisma.InputJsonValue | undefined,
      trustedSigningKeys: input.trustedSigningKeys as Prisma.InputJsonValue | undefined,
      policyHash: input.policyHash,
      spoolDepth: input.spoolDepth,
      deadLetterDepth: input.deadLetterDepth,
      activeAttemptCount: input.activeAttemptCount,
      lastError: input.lastError,
    },
  });
  if (result.count !== 1) throw new RunbookAgentNotFoundError(input.agentId);
  return { serverTime: new Date().toISOString() };
}

export async function claimAgentAttempt(agentId: string, confidentialTransport = false) {
  for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt++) {
    try {
      const claimedAttempt = await prisma.$transaction(
        async tx => {
          const now = new Date();
          const agent = await tx.runbookAgent.findFirst({
            where: { id: agentId, status: { in: ['ONLINE', 'DEGRADED'] } },
            select: { id: true, capabilities: true },
          });
          if (!agent) throw new RunbookAgentNotFoundError(agentId);
          const capabilities = Array.isArray(agent.capabilities)
            ? agent.capabilities.filter((value): value is string => typeof value === 'string')
            : [];
          const supportedStepTypes = capabilities
            .filter(capability => capability.startsWith('RUNBOOK_'))
            .map(capability => capability.slice('RUNBOOK_'.length))
            .filter((type): type is RunbookStepType =>
              ['LINUX_DIAGNOSTICS', 'SYSTEMD', 'DOCKER', 'KUBERNETES', 'BASH'].includes(type)
            );
          if (supportedStepTypes.length === 0) return null;
          const claimWhere: Prisma.RunbookStepAttemptWhereInput = {
            status: 'PENDING',
            availableAt: { lte: now },
            claimDeadlineAt: { gt: now },
            OR: [
              { targetAgentId: agentId },
              {
                targetAgentId: null,
                targetAgentPool: { members: { some: { agentId } } },
              },
            ],
            executionStep: {
              type: { in: supportedStepTypes },
              OR: [
                { type: { not: 'DOCKER' } },
                {
                  containerRuntime: {
                    in: [
                      ...(!capabilities.includes('RUNBOOK_PODMAN') ||
                      capabilities.includes('RUNBOOK_DOCKER_RUNTIME')
                        ? ['docker']
                        : []),
                      ...(capabilities.includes('RUNBOOK_PODMAN') ? ['podman'] : []),
                    ],
                  },
                },
              ],
              execution: {
                status: { in: ['RUNNING', 'WAITING_AGENT'] },
                cancelRequestedAt: null,
                deadlineAt: { gt: now },
              },
            },
          };
          const allowConfidential =
            confidentialTransport ||
            (process.env.NODE_ENV === 'development' &&
              process.env.OPSKNIGHT_ALLOW_INSECURE_AGENT_SECRETS === 'true');
          const candidates = await tx.runbookStepAttempt.findMany({
            where: {
              ...claimWhere,
              ...(!allowConfidential ? { requiresConfidentialTransport: false } : {}),
            },
            orderBy: { createdAt: 'asc' },
            take: 50,
            include: {
              targetAgentPool: { select: { mode: true, _count: { select: { members: true } } } },
              executionStep: {
                include: {
                  execution: {
                    select: {
                      id: true,
                      inputValues: true,
                      definitionChecksum: true,
                      deadlineAt: true,
                      targetSelection: true,
                    },
                  },
                },
              },
            },
          });
          let blockedSecretTransport = false;
          const eligible = candidates.filter(candidate => {
            if (!agentSupportsStep(capabilities, candidate.executionStep.type)) return false;
            if (
              !candidate.targetAgentId &&
              candidate.executionStep.riskClass !== 'READ_ONLY' &&
              candidate.targetAgentPool?.mode === 'LOCAL_HOSTS' &&
              candidate.targetAgentPool._count.members > 1
            ) {
              return false;
            }
            const keys = referencedStepInputKeys(candidate.executionStep.config);
            const inputs = candidate.executionStep.execution.inputValues as Record<string, unknown>;
            const hasSecrets = Object.entries(inputs).some(
              ([key, value]) => keys.has(key) && isSecretReference(value)
            );
            if (
              hasSecrets &&
              !confidentialTransport &&
              !(
                process.env.NODE_ENV === 'development' &&
                process.env.OPSKNIGHT_ALLOW_INSECURE_AGENT_SECRETS === 'true'
              )
            ) {
              blockedSecretTransport = true;
              return false;
            }
            return agentSupportsStep(capabilities, candidate.executionStep.type);
          });
          if (eligible.length === 0) {
            if (
              !allowConfidential &&
              (await tx.runbookStepAttempt.findFirst({
                where: { ...claimWhere, requiresConfidentialTransport: true },
                select: { id: true },
              }))
            )
              blockedSecretTransport = true;
            if (blockedSecretTransport)
              throw new RunbookDefinitionError(
                'HTTPS required for secret-backed steps. Configure this Agent with a trusted HTTPS control-plane URL.'
              );
            return null;
          }
          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "RunbookStepAttempt"
            WHERE "id" IN (${Prisma.join(eligible.map(candidate => candidate.id))})
              AND "status" = 'PENDING'
            ORDER BY "createdAt", "id"
            LIMIT 1 FOR UPDATE SKIP LOCKED
          `;
          const attempt = eligible.find(candidate => candidate.id === locked[0]?.id);
          if (!attempt) return null;
          const selection = attempt.executionStep.execution.targetSelection;
          const sourcePoolId =
            selection &&
            typeof selection === 'object' &&
            !Array.isArray(selection) &&
            typeof selection.sourcePoolId === 'string'
              ? selection.sourcePoolId
              : null;
          if (
            sourcePoolId &&
            !(await tx.runbookAgentPoolMember.findUnique({
              where: { poolId_agentId: { poolId: sourcePoolId, agentId } },
              select: { id: true },
            }))
          )
            return null;
          if (
            sourcePoolId &&
            selection &&
            typeof selection === 'object' &&
            !Array.isArray(selection) &&
            selection.implicitLocalHost === true &&
            (await tx.runbookAgentPoolMember.count({ where: { poolId: sourcePoolId } })) !== 1
          )
            return null;
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
          const allInputValues = attempt.executionStep.execution.inputValues as Record<
            string,
            unknown
          >;
          const referencedKeys = referencedStepInputKeys(attempt.executionStep.config);
          const rawInputValues = Object.fromEntries(
            Object.entries(allInputValues).filter(([key]) => referencedKeys.has(key))
          );
          const resolvedInputValues = await resolveSecretInputValues(
            rawInputValues,
            {
              agentId,
              targetAgentPoolId:
                attempt.targetAgentPoolId ??
                (() => {
                  const selection = attempt.executionStep.execution.targetSelection;
                  return selection &&
                    typeof selection === 'object' &&
                    !Array.isArray(selection) &&
                    typeof selection.sourcePoolId === 'string'
                    ? selection.sourcePoolId
                    : null;
                })(),
            },
            tx
          );
          const resolvedConfig = resolveInputTemplates(
            attempt.executionStep.config,
            resolvedInputValues
          ) as Record<string, unknown>;
          validateResolvedStepConfig(
            {
              key: attempt.executionStep.stepKey,
              name: attempt.executionStep.name,
              type: attempt.executionStep.type,
              riskClass: attempt.executionStep.riskClass,
              config: resolvedConfig,
            },
            resolvedConfig
          );
          return {
            signingAgentId: agentId,
            executionDeadlineAt: attempt.executionStep.execution.deadlineAt.toISOString(),
            definitionChecksum: attempt.executionStep.execution.definitionChecksum,
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
              config: resolvedConfig,
              timeoutSeconds: Math.max(
                1,
                Math.min(
                  attempt.executionStep.timeoutSeconds ?? DEFAULT_LEASE_DURATION_SECONDS,
                  Math.floor(
                    (attempt.executionStep.execution.deadlineAt.getTime() - now.getTime()) / 1000
                  )
                )
              ),
            },
            inputValues: resolvedInputValues,
            secretInputKeys: Object.entries(rawInputValues)
              .filter(([, value]) => isSecretReference(value))
              .map(([key]) => key),
          };
        },
        { isolationLevel: 'ReadCommitted' }
      );
      return claimedAttempt ? await signExecutionEnvelope(claimedAttempt) : null;
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2034' && transactionAttempt < 2) continue;
      throw error;
    }
  }
  return null;
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
  return prisma.$transaction(async tx => {
    const now = new Date();
    const authority = await tx.runbookStepAttempt.findUnique({
      where: { id: input.attemptId },
      select: { executionStep: { select: { execution: { select: { targetSelection: true } } } } },
    });
    const selection = authority?.executionStep.execution.targetSelection;
    const sourcePoolId =
      selection &&
      typeof selection === 'object' &&
      !Array.isArray(selection) &&
      typeof selection.sourcePoolId === 'string'
        ? selection.sourcePoolId
        : null;
    if (
      sourcePoolId &&
      !(await tx.runbookAgentPoolMember.findUnique({
        where: { poolId_agentId: { poolId: sourcePoolId, agentId: input.agentId } },
        select: { id: true },
      }))
    )
      throw new RunbookPreExecutionFenceError(
        input.attemptId,
        'Selected Agent is no longer a member of the source pool'
      );
    if (
      sourcePoolId &&
      selection &&
      typeof selection === 'object' &&
      !Array.isArray(selection) &&
      selection.implicitLocalHost === true &&
      (await tx.runbookAgentPoolMember.count({ where: { poolId: sourcePoolId } })) !== 1
    )
      throw new RunbookPreExecutionFenceError(
        input.attemptId,
        'Implicit local host target became ambiguous'
      );
    const fence = {
      id: input.attemptId,
      claimedAgentId: input.agentId,
      leaseToken: leaseHash(input.leaseToken),
      leaseExpiresAt: { gt: now },
      claimedAgent: { status: { in: ['ONLINE', 'DEGRADED'] } },
      executionStep: {
        execution: {
          cancelRequestedAt: null,
          status: { in: ['RUNNING', 'WAITING_AGENT'] },
          deadlineAt: { gt: now },
        },
      },
    } satisfies Prisma.RunbookStepAttemptWhereInput;
    const updated = await tx.runbookStepAttempt.updateMany({
      where: {
        ...fence,
        status: 'CLAIMED',
        OR: [
          { executionStep: { riskClass: 'READ_ONLY' } },
          { targetAgentId: input.agentId },
          { targetAgentPool: { mode: 'SHARED_TARGET' } },
          {
            targetAgentPool: {
              mode: 'LOCAL_HOSTS',
              members: {
                some: { agentId: input.agentId },
                none: { agentId: { not: input.agentId } },
              },
            },
          },
        ],
      },
      data: {
        status: 'RUNNING',
        startedAt: now,
        leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_DURATION_SECONDS * 1000),
      },
    });
    if (updated.count !== 1) {
      const running = await tx.runbookStepAttempt.findFirst({
        where: { ...fence, status: 'RUNNING' },
        select: { startedAt: true, leaseExpiresAt: true },
      });
      if (running?.startedAt && running.leaseExpiresAt)
        return {
          startedAt: running.startedAt.toISOString(),
          leaseExpiresAt: running.leaseExpiresAt.toISOString(),
          alreadyStarted: true,
        };
      throw new RunbookPreExecutionFenceError(
        input.attemptId,
        'lease, cancellation, or execution state changed'
      );
    }
    await tx.runbookExecutionStep.updateMany({
      where: { attempts: { some: { id: input.attemptId } }, status: 'WAITING_AGENT' },
      data: { status: 'RUNNING' },
    });
    return {
      startedAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_DURATION_SECONDS * 1000).toISOString(),
      alreadyStarted: false,
    };
  });
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
      claimedAgent: { status: { not: 'REVOKED' } },
    },
    select: {
      executionStep: {
        select: {
          execution: { select: { cancelRequestedAt: true, status: true, deadlineAt: true } },
        },
      },
    },
  });
  if (!attempt) throw new RunbookAgentLeaseExpiredError(input.attemptId, input.agentId);
  if (
    attempt.executionStep.execution.cancelRequestedAt ||
    attempt.executionStep.execution.deadlineAt <= now ||
    !['RUNNING', 'WAITING_AGENT'].includes(attempt.executionStep.execution.status)
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
  const renewedUntil = new Date(
    Math.min(
      now.getTime() + DEFAULT_LEASE_DURATION_SECONDS * 1000,
      attempt.executionStep.execution.deadlineAt.getTime()
    )
  );
  const updated = await prisma.runbookStepAttempt.updateMany({
    where: {
      id: input.attemptId,
      claimedAgentId: input.agentId,
      leaseToken: leaseHash(input.leaseToken),
      leaseExpiresAt: { gt: now },
      status: 'RUNNING',
    },
    data: { leaseExpiresAt: renewedUntil },
  });
  if (updated.count !== 1) throw new RunbookAgentLeaseExpiredError(input.attemptId, input.agentId);
  return {
    leaseExpiresAt: renewedUntil.toISOString(),
    cancelRequested: false,
  };
}

export async function submitAgentResult(agentId: string, raw: AgentJobResultInput) {
  const input = agentJobResultSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const agent = await tx.runbookAgent.findFirst({
      where: { id: agentId, status: { not: 'REVOKED' } },
      select: { id: true },
    });
    if (!agent) throw new RunbookAgentNotFoundError(agentId);
    const attempt = await tx.runbookStepAttempt.findUnique({
      where: { id: input.attemptId },
      include: {
        targetAgentPool: { select: { mode: true } },
        executionStep: { include: { execution: true } },
      },
    });
    if (!attempt || attempt.claimedAgentId !== agentId)
      throw new RunbookAgentNotFoundError(agentId);
    // Older Agents may report a started write as FAILED even though its effect is unknown.
    if (
      input.status === 'FAILED' &&
      attempt.executionStep.riskClass !== 'READ_ONLY' &&
      ['COMMAND_TIMEOUT', 'COMMAND_FAILED'].includes(input.errorCode ?? '')
    ) {
      input.status = 'UNKNOWN';
    }
    if (attempt.status === 'UNKNOWN' && attempt.errorCode === 'AGENT_LEASE_EXPIRED') {
      if (
        attempt.executionStep.status !== 'UNKNOWN' ||
        attempt.executionStep.errorCode !== 'UNKNOWN_OUTCOME'
      ) {
        throw new RunbookPreExecutionFenceError(
          input.attemptId,
          'a safe retry already superseded this ambiguous attempt'
        );
      }
      const producedAt = input.producedAt ? new Date(input.producedAt) : null;
      const latestCredibleProduction = attempt.leaseExpiresAt
        ? new Date(attempt.leaseExpiresAt.getTime() + 60_000)
        : null;
      if (
        !producedAt ||
        !latestCredibleProduction ||
        producedAt > latestCredibleProduction ||
        producedAt > attempt.executionStep.execution.deadlineAt ||
        producedAt > new Date(Date.now() + 60_000) ||
        attempt.leaseToken !== leaseHash(input.leaseToken)
      ) {
        throw new RunbookPreExecutionFenceError(
          input.attemptId,
          'late result is outside the signed result-recovery fence'
        );
      }
      const executionOutcomeUnknown =
        attempt.executionStep.execution.status === 'FAILED' &&
        attempt.executionStep.execution.failureCode === 'UNKNOWN_OUTCOME';
      const cancellationRequested =
        Boolean(attempt.executionStep.execution.cancelRequestedAt) ||
        (!executionOutcomeUnknown &&
          !['RUNNING', 'WAITING_AGENT'].includes(attempt.executionStep.execution.status));
      if (
        (cancellationRequested && input.status !== 'CANCELLED') ||
        (!cancellationRequested && input.status === 'CANCELLED') ||
        input.status === 'UNKNOWN'
      ) {
        throw new RunbookPreExecutionFenceError(
          input.attemptId,
          'late result conflicts with cancellation or remains ambiguous'
        );
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
      const recovered = await tx.runbookStepAttempt.updateMany({
        where: {
          id: attempt.id,
          status: 'UNKNOWN',
          errorCode: 'AGENT_LEASE_EXPIRED',
          claimedAgentId: agentId,
          leaseToken: leaseHash(input.leaseToken),
        },
        data: {
          status: input.status,
          completedAt: producedAt,
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
      if (recovered.count !== 1) {
        throw new RunbookPreExecutionFenceError(input.attemptId, 'late result state changed');
      }
      const stepStatus = input.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED';
      const recoveredStep = await tx.runbookExecutionStep.updateMany({
        where: { id: attempt.executionStepId, status: 'UNKNOWN', errorCode: 'UNKNOWN_OUTCOME' },
        data: {
          status: stepStatus,
          completedAt: producedAt,
          outputPreview,
          outputArtifactId: input.outputArtifactId,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage ? redactRunbookOutput(input.errorMessage) : undefined,
        },
      });
      if (recoveredStep.count !== 1) {
        throw new RunbookPreExecutionFenceError(input.attemptId, 'late result step state changed');
      }
      await tx.runbookExecution.updateMany({
        where: {
          id: attempt.executionStep.executionId,
          status: 'FAILED',
          failureCode: 'UNKNOWN_OUTCOME',
        },
        data: {
          status: 'RUNNING',
          completedAt: null,
          failureCode: null,
          failureMessage: null,
        },
      });
      await tx.backgroundJob.create({
        data: {
          type: 'RUNBOOK',
          status: 'PENDING',
          scheduledAt: new Date(),
          maxAttempts: 8,
          payload: {
            kind: 'ADVANCE_EXECUTION',
            executionId: attempt.executionStep.executionId,
          },
        },
      });
      return { accepted: true, duplicate: false, status: input.status, reconciledLate: true };
    }
    if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN'].includes(attempt.status)) {
      return { accepted: true, duplicate: true, status: attempt.status };
    }
    const resultProducedAt = input.producedAt ? new Date(input.producedAt) : new Date();
    if (resultProducedAt > attempt.executionStep.execution.deadlineAt) {
      throw new RunbookPreExecutionFenceError(
        input.attemptId,
        'result was produced after the execution deadline'
      );
    }
    const cancellationRequested =
      Boolean(attempt.executionStep.execution.cancelRequestedAt) ||
      !['RUNNING', 'WAITING_AGENT'].includes(attempt.executionStep.execution.status);
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
    const retryFailed =
      resultStatus === 'FAILED' &&
      isRetryable(attempt.executionStep.riskClass) &&
      isRetryableFailure(attempt.executionStep.riskClass, input.errorCode);
    const shouldRetry =
      (retryUnknown || retryFailed) && attempt.attemptNumber <= attempt.executionStep.maxRetries;
    const completed = await tx.runbookStepAttempt.updateMany({
      where: { id: attempt.id, status: 'RUNNING', claimedAgentId: agentId },
      data: {
        status: resultStatus,
        completedAt: resultProducedAt,
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
          requiresConfidentialTransport: attempt.requiresConfidentialTransport,
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
        completedAt: resultProducedAt,
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
        executionStep: {
          execution: {
            cancelRequestedAt: null,
            status: { in: ['RUNNING', 'WAITING_AGENT'] },
            deadlineAt: { gt: new Date() },
          },
        },
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
