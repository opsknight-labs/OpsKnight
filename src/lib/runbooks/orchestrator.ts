import 'server-only';

import crypto from 'crypto';
import type { IncidentEventType, Prisma, RunbookExecutionStep } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { safeOutboundFetch } from '@/lib/network-security';
import {
  computePlanDigest,
  computeDefinitionChecksum,
  containsSecretReference,
  referencedStepInputKeys,
  isSecretReference,
  flattenSteps,
  parseRunbookDefinition,
  resolveInputTemplates,
  validateResolvedStepConfig,
} from './definition';
import { matchesCondition } from './matcher';
import { finalizeVerificationEvidence } from './verification-evidence';
import { workflowConditionSchema } from './conditions';
import { applyRunbookInputDefaults, validateBindingInputValues } from './bindings';
import { suggestionPlanSchema } from './suggestion-plan';
import {
  DEFAULT_EXECUTION_TIMEOUT_SECONDS,
  DEFAULT_STEP_TIMEOUT_SECONDS,
  CIRCUIT_BREAKER_FAIL_THRESHOLD,
  MAX_AUTO_WRITE_ACTIONS_PER_SERVICE,
  MAX_CONCURRENT_WRITE_ACTIONS_PER_POOL,
  MAX_OUTPUT_PREVIEW_BYTES,
  isRetryable,
  requiresAgent,
} from './types';
import {
  agentSupportsStep,
  isRetryableFailure,
  retryDelayMs,
  stepRequiresApproval,
} from './safety';
import {
  RunbookApprovalPlanChangedError,
  RunbookDefinitionError,
  RunbookExecutionInvalidTransitionError,
  RunbookExecutionNotFoundError,
} from './errors';

const jobPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ADVANCE_EXECUTION'), executionId: z.string().cuid() }).strict(),
  z.object({ kind: z.literal('RECONCILE_EXECUTION'), executionId: z.string().cuid() }).strict(),
  z
    .object({
      kind: z.literal('EVALUATE_TRIGGER'),
      incidentId: z.string().cuid(),
      sourceEventId: z.string().min(1).max(200),
    })
    .strict(),
]);

const TERMINAL_STEP = new Set(['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED']);

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function enqueueAdvance(
  tx: Prisma.TransactionClient,
  executionId: string,
  scheduledAt = new Date()
) {
  await tx.backgroundJob.create({
    data: {
      type: 'RUNBOOK',
      status: 'PENDING',
      scheduledAt,
      maxAttempts: 8,
      payload: { kind: 'ADVANCE_EXECUTION', executionId },
    },
  });
}

async function addIncidentRunbookEvent(
  tx: Prisma.TransactionClient,
  incidentId: string | null | undefined,
  type: IncidentEventType,
  message: string
) {
  if (!incidentId) return;
  await tx.incidentEvent.create({ data: { incidentId, type, message } });
}

function executionSteps(definition: ReturnType<typeof parseRunbookDefinition>) {
  return flattenSteps(definition).map((step, sequence) => ({ ...step, sequence }));
}

export async function startRunbookExecution(input: {
  runbookId: string;
  runbookVersionId?: string;
  serviceId?: string;
  incidentId?: string;
  bindingId?: string;
  suggestionId?: string;
  inputValues?: Record<string, unknown>;
  triggeredByUserId?: string;
  triggerFingerprint?: string;
  triggerId?: string;
}) {
  return prisma.$transaction(async tx => {
    const runbook = await tx.runbook.findFirst({
      where: { id: input.runbookId, archivedAt: null },
      include: { publishedVersion: true },
    });
    if (!runbook) throw new RunbookDefinitionError('Runbook not found or archived.');
    const binding = input.bindingId
      ? await tx.serviceRunbookBinding.findFirst({
          where: {
            id: input.bindingId,
            runbookId: runbook.id,
            enabled: true,
            ...(input.serviceId ? { serviceId: input.serviceId } : {}),
            ...(input.triggerId
              ? { triggers: { some: { id: input.triggerId, enabled: true } } }
              : {}),
          },
        })
      : null;
    if (input.bindingId && !binding) {
      throw new RunbookDefinitionError(
        'Runbook binding, trigger, service, and runbook do not form a valid execution boundary.'
      );
    }
    if (input.triggerId && !input.bindingId) {
      throw new RunbookDefinitionError('A trigger execution requires its service binding.');
    }
    const suggestion = input.suggestionId
      ? await tx.runbookSuggestion.findFirst({
          where: {
            id: input.suggestionId,
            state: 'SUGGESTED',
            incidentId: input.incidentId,
            bindingId: input.bindingId,
            binding: { runbookId: runbook.id, enabled: true },
          },
        })
      : null;
    if (input.suggestionId && !suggestion) {
      throw new RunbookDefinitionError('Runbook suggestion is unavailable or already handled.');
    }
    const suggestedPlan = suggestion
      ? suggestionPlanSchema.safeParse(suggestion.planSnapshot)
      : null;
    if (suggestedPlan && !suggestedPlan.success)
      throw new RunbookDefinitionError(
        'Suggestion has no valid frozen plan. Dismiss it and generate a new suggestion.'
      );
    const planSnapshot = suggestedPlan?.success ? suggestedPlan.data : null;
    const resolvedServiceId = input.serviceId ?? binding?.serviceId;
    if (input.incidentId) {
      const incident = await tx.incident.findFirst({
        where: {
          id: input.incidentId,
          ...(resolvedServiceId ? { serviceId: resolvedServiceId } : {}),
        },
        select: { serviceId: true },
      });
      if (!incident) {
        throw new RunbookDefinitionError('Incident does not belong to the execution service.');
      }
      if (!resolvedServiceId) {
        throw new RunbookDefinitionError('Incident runbook execution requires a service boundary.');
      }
    }
    const versionId =
      suggestion?.runbookVersionId ?? input.runbookVersionId ?? runbook.publishedVersionId;
    if (!versionId) throw new RunbookDefinitionError('Runbook must be published before execution.');
    const version = await tx.runbookVersion.findFirst({
      where: {
        id: versionId,
        runbookId: runbook.id,
        state:
          input.runbookVersionId || suggestion ? { in: ['PUBLISHED', 'RETIRED'] } : 'PUBLISHED',
      },
      include: { inputs: { orderBy: { sequence: 'asc' } } },
    });
    if (!version)
      throw new RunbookDefinitionError('Only an immutable published version can execute.');
    if (
      version.state === 'RETIRED' &&
      !suggestion &&
      (!binding || binding.versionStrategy !== 'PINNED' || binding.runbookVersionId !== version.id)
    ) {
      throw new RunbookDefinitionError(
        'A retired version can execute only through the binding that pinned it while published.'
      );
    }
    const definition = parseRunbookDefinition(version.definition, version.inputs);
    if (computeDefinitionChecksum(definition) !== version.checksum) {
      throw new RunbookDefinitionError('Published runbook checksum does not match its definition.');
    }
    if (planSnapshot && planSnapshot.definitionChecksum !== version.checksum)
      throw new RunbookDefinitionError('Suggested definition checksum changed.');
    const steps = executionSteps(definition);
    let resolvedTargetAgentId = planSnapshot
      ? planSnapshot.agentId
      : (binding?.defaultAgentId ?? null);
    const resolvedTargetAgentPoolId = planSnapshot
      ? planSnapshot.agentPoolId
      : (binding?.defaultAgentPoolId ?? null);
    if (
      steps.some(step => requiresAgent(step.type)) &&
      !resolvedTargetAgentId &&
      !resolvedTargetAgentPoolId &&
      !Object.keys(
        (planSnapshot?.agentSelector ?? binding?.agentSelector ?? {}) as Record<string, unknown>
      ).length
    ) {
      throw new RunbookDefinitionError(
        'TARGET_NOT_CONFIGURED: Agent-executed steps require a snapshotted Agent or Agent pool target.'
      );
    }
    const resolvedInputs = applyRunbookInputDefaults(
      version.inputs,
      planSnapshot
        ? planSnapshot.inputValues
        : binding
          ? (binding.inputValues as Record<string, unknown>)
          : (input.inputValues ?? {})
    );
    validateBindingInputValues(version.inputs, resolvedInputs);
    const selector = (planSnapshot?.agentSelector ?? binding?.agentSelector ?? {}) as Record<
      string,
      string
    >;
    let selectedLabels = selector;
    let implicitLocalHost = false;
    if (Object.keys(selector).length && !resolvedTargetAgentId) {
      const incident = input.incidentId
        ? await tx.incident.findUnique({
            where: { id: input.incidentId },
            select: { tags: { select: { tag: { select: { name: true } } } } },
          })
        : null;
      const labels = Object.fromEntries(
        (incident?.tags ?? []).flatMap(({ tag }) => {
          const split = tag.name.indexOf('=');
          return split > 0 ? [[tag.name.slice(0, split), tag.name.slice(split + 1)]] : [];
        })
      );
      const resolvedSelector = Object.fromEntries(
        Object.entries(selector).map(([key, value]) => {
          const reference = /^\$\{\{\s*incident\.labels\.([a-zA-Z0-9_.-]+)\s*\}\}$/.exec(value);
          const resolved = reference
            ? Object.entries(labels).find(([name]) => name === reference[1])?.[1]
            : resolveInputTemplates(value, resolvedInputs);
          if (typeof resolved !== 'string' || !resolved)
            throw new RunbookDefinitionError(
              'TARGET_NOT_FOUND: selector input or incident label is unavailable.'
            );
          return [key, resolved];
        })
      );
      const candidates = await tx.runbookAgent.findMany({
        where: {
          status: 'ONLINE',
          lastHeartbeatAt: { gte: new Date(Date.now() - 90000) },
          ...(resolvedTargetAgentPoolId
            ? { poolMemberships: { some: { poolId: resolvedTargetAgentPoolId } } }
            : {}),
          AND: Object.entries(resolvedSelector).map(([key, value]) => ({
            labels: { path: [key], equals: value },
          })),
        },
        select: { id: true, capabilities: true },
        orderBy: [{ activeAttemptCount: 'asc' }, { id: 'asc' }],
      });
      selectedLabels = resolvedSelector;
      const eligible = candidates.filter(agent =>
        steps
          .filter(step => requiresAgent(step.type))
          .every(
            step =>
              Array.isArray(agent.capabilities) &&
              agentSupportsStep(
                agent.capabilities.filter((value): value is string => typeof value === 'string'),
                step.type
              ) &&
              (step.type !== 'DOCKER' ||
                ((resolveInputTemplates(step.config, resolvedInputs) as Record<string, unknown>)
                  .runtime === 'podman'
                  ? agent.capabilities.includes('RUNBOOK_PODMAN')
                  : !agent.capabilities.includes('RUNBOOK_PODMAN') ||
                    agent.capabilities.includes('RUNBOOK_DOCKER_RUNTIME')))
          )
      );
      const pool = resolvedTargetAgentPoolId
        ? await tx.runbookAgentPool.findUniqueOrThrow({
            where: { id: resolvedTargetAgentPoolId },
            select: { mode: true },
          })
        : null;
      if (!eligible.length)
        throw new RunbookDefinitionError(
          'TARGET_NOT_FOUND: no healthy capable Agent matches the selector.'
        );
      if (
        steps.some(step => requiresAgent(step.type) && step.riskClass !== 'READ_ONLY') &&
        pool?.mode !== 'SHARED_TARGET' &&
        eligible.length !== 1
      )
        throw new RunbookDefinitionError(
          'TARGET_AMBIGUOUS: local write selector must resolve to exactly one Agent.'
        );
      resolvedTargetAgentId = eligible[0].id;
    }
    for (const step of steps) {
      const resolvedConfig = resolveInputTemplates(step.config, resolvedInputs) as Record<
        string,
        unknown
      >;
      validateResolvedStepConfig(step, resolvedConfig);
    }
    const executionStartedAt = new Date();
    const executionTimeoutSeconds =
      definition.defaultTimeoutSeconds ?? DEFAULT_EXECUTION_TIMEOUT_SECONDS;
    const hasWriteAction = steps.some(step => step.riskClass !== 'READ_ONLY');
    if (!input.triggeredByUserId && input.incidentId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runbook-incident-budget:${input.incidentId}`}))`;
      const limits = await tx.systemSettings.findUnique({ where: { id: 'default' } });
      const automatic = { incidentId: input.incidentId, triggeredByUserId: null };
      const [usedExecutions, usedWrites, usedNonIdempotent] = await Promise.all([
        tx.runbookExecution.count({ where: automatic }),
        tx.runbookExecutionStep.count({
          where: {
            execution: automatic,
            riskClass: { in: ['IDEMPOTENT_WRITE', 'NON_IDEMPOTENT'] },
          },
        }),
        tx.runbookExecutionStep.count({
          where: { execution: automatic, riskClass: 'NON_IDEMPOTENT' },
        }),
      ]);
      if (
        usedExecutions >= (limits?.runbookAutoExecutionsPerIncident ?? 3) ||
        usedWrites + steps.filter(step => step.riskClass !== 'READ_ONLY').length >
          (limits?.runbookAutoWritesPerIncident ?? 3) ||
        usedNonIdempotent + steps.filter(step => step.riskClass === 'NON_IDEMPOTENT').length >
          (limits?.runbookAutoNonIdempotentPerIncident ?? 0)
      )
        throw new RunbookDefinitionError(
          'AUTO_REMEDIATION_BUDGET_EXHAUSTED: responder approval is required.'
        );
    }
    if (!input.triggeredByUserId && hasWriteAction) {
      if (!resolvedServiceId) {
        throw new RunbookDefinitionError('Automatic write runbooks require a service boundary.');
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runbook-service:${resolvedServiceId}`}))`;
      const activeServiceWrites = await tx.runbookExecution.count({
        where: {
          serviceId: resolvedServiceId,
          triggeredByUserId: null,
          status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
          steps: { some: { riskClass: { in: ['IDEMPOTENT_WRITE', 'NON_IDEMPOTENT'] } } },
        },
      });
      if (activeServiceWrites >= MAX_AUTO_WRITE_ACTIONS_PER_SERVICE) {
        throw new RunbookDefinitionError(
          'AUTOMATION_BLAST_RADIUS_LIMIT: too many automatic write runbooks are active for this service.'
        );
      }
      const recentFailures = await tx.runbookExecution.count({
        where: {
          serviceId: resolvedServiceId,
          status: 'FAILED',
          completedAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
      });
      if (recentFailures >= CIRCUIT_BREAKER_FAIL_THRESHOLD) {
        throw new RunbookDefinitionError(
          'AUTOMATION_CIRCUIT_OPEN: recent runbook failures require operator review.'
        );
      }
    }
    if (hasWriteAction && resolvedTargetAgentPoolId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runbook-pool:${resolvedTargetAgentPoolId}`}))`;
      if (
        !resolvedTargetAgentId &&
        steps.some(step => requiresAgent(step.type) && step.riskClass !== 'READ_ONLY')
      ) {
        const pool = await tx.runbookAgentPool.findUniqueOrThrow({
          where: { id: resolvedTargetAgentPoolId },
          select: { mode: true, _count: { select: { members: true } } },
        });
        if (pool.mode === 'LOCAL_HOSTS' && pool._count.members > 1) {
          throw new RunbookDefinitionError(
            'TARGET_AMBIGUOUS: AMBIGUOUS_HOST_TARGET: writes to a multi-member LOCAL_HOSTS pool require a specific Agent.'
          );
        }
        if (pool.mode === 'LOCAL_HOSTS') {
          const host = await tx.runbookAgent.findFirst({
            where: {
              status: 'ONLINE',
              lastHeartbeatAt: { gte: new Date(Date.now() - 90000) },
              poolMemberships: { some: { poolId: resolvedTargetAgentPoolId } },
            },
            select: { id: true, capabilities: true },
          });
          if (!host)
            throw new RunbookDefinitionError(
              'TARGET_NOT_FOUND: local write pool has no healthy host.'
            );
          if (
            !Array.isArray(host.capabilities) ||
            !steps
              .filter(step => requiresAgent(step.type))
              .every(
                step =>
                  agentSupportsStep(host.capabilities as string[], step.type) &&
                  (step.type !== 'DOCKER' ||
                    (step.config.runtime === 'podman'
                      ? (host.capabilities as string[]).includes('RUNBOOK_PODMAN')
                      : !(host.capabilities as string[]).includes('RUNBOOK_PODMAN') ||
                        (host.capabilities as string[]).includes('RUNBOOK_DOCKER_RUNTIME')))
              )
          )
            throw new RunbookDefinitionError(
              'TARGET_NOT_FOUND: local write host lacks an effective executor.'
            );
          resolvedTargetAgentId = host.id;
          implicitLocalHost = true;
        }
      }
      const activePoolWrites = await tx.runbookExecutionStep.count({
        where: {
          riskClass: { in: ['IDEMPOTENT_WRITE', 'NON_IDEMPOTENT'] },
          status: { in: ['PENDING', 'READY', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
          execution: {
            OR: [
              { resolvedTargetAgentPoolId },
              { targetSelection: { path: ['sourcePoolId'], equals: resolvedTargetAgentPoolId } },
            ],
            status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
          },
        },
      });
      if (activePoolWrites >= MAX_CONCURRENT_WRITE_ACTIONS_PER_POOL) {
        throw new RunbookDefinitionError(
          'AGENT_POOL_CONCURRENCY_LIMIT: too many write actions are active for this Agent pool.'
        );
      }
    }
    const execution = await tx.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        serviceId: resolvedServiceId,
        incidentId: input.incidentId,
        bindingId: input.bindingId,
        triggerFingerprint: input.triggerFingerprint ?? suggestion?.fingerprint,
        triggerId: input.triggerId ?? suggestion?.triggerId,
        triggeredByType: input.triggeredByUserId ? 'USER' : 'TRIGGER',
        triggeredByUserId: input.triggeredByUserId,
        inputValues: asJson(resolvedInputs),
        definitionChecksum: version.checksum,
        timeoutSeconds: executionTimeoutSeconds,
        deadlineAt: new Date(executionStartedAt.getTime() + executionTimeoutSeconds * 1000),
        resolvedTargetAgentId,
        resolvedTargetAgentPoolId: resolvedTargetAgentId ? null : resolvedTargetAgentPoolId,
        targetSelection: {
          selector,
          resolvedSelector: selectedLabels,
          implicitLocalHost,
          selectedAgentId: resolvedTargetAgentId,
          sourcePoolId: resolvedTargetAgentPoolId,
        },
        steps: {
          create: steps.map(step => ({
            stepKey: step.key,
            sequence: step.sequence,
            name: step.name,
            type: step.type,
            containerRuntime:
              step.type === 'DOCKER' &&
              (resolveInputTemplates(step.config, resolvedInputs) as Record<string, unknown>)
                .runtime === 'podman'
                ? 'podman'
                : 'docker',
            riskClass: step.riskClass,
            config: asJson(step.config),
            requiresApproval: stepRequiresApproval(step),
            timeoutSeconds: step.timeoutSeconds ?? DEFAULT_STEP_TIMEOUT_SECONDS,
            maxRetries: step.maxRetries ?? definition.defaultMaxRetries ?? 0,
          })),
        },
      },
    });
    if (suggestion) {
      const startedSuggestion = await tx.runbookSuggestion.updateMany({
        where: { id: suggestion.id, state: 'SUGGESTED' },
        data: { state: 'STARTED', startedAt: executionStartedAt },
      });
      if (startedSuggestion.count !== 1) {
        throw new RunbookDefinitionError('Runbook suggestion was already handled.');
      }
    }
    await addIncidentRunbookEvent(
      tx,
      input.incidentId,
      'RUNBOOK_STARTED',
      `Runbook started: ${runbook.name}`
    );
    await enqueueAdvance(tx, execution.id);
    await logAudit(
      {
        action: 'runbook.execution.started',
        entityType: 'RUNBOOK_EXECUTION',
        entityId: execution.id,
        actorId: input.triggeredByUserId,
        details: {
          runbookId: runbook.id,
          versionId: version.id,
          incidentId: input.incidentId ?? null,
          serviceId: resolvedServiceId ?? null,
        },
      },
      tx
    );
    return execution;
  });
}

function resolvedPlanDigest(
  step: RunbookExecutionStep,
  execution: {
    definitionChecksum: string;
    inputValues: Prisma.JsonValue;
    resolvedTargetAgentId?: string | null;
    resolvedTargetAgentPoolId?: string | null;
  }
) {
  return computePlanDigest({
    stepKey: step.stepKey,
    stepType: step.type,
    riskClass: step.riskClass,
    config: step.config as Record<string, unknown>,
    agentPoolId: execution.resolvedTargetAgentPoolId ?? undefined,
    agentId: execution.resolvedTargetAgentId ?? undefined,
    inputValues: execution.inputValues as Record<string, unknown>,
    versionChecksum: execution.definitionChecksum,
  });
}

async function executeHttpStep(
  step: RunbookExecutionStep,
  config: Record<string, unknown>,
  deadlineAt: Date
): Promise<string> {
  if (typeof config.url !== 'string') throw new RunbookDefinitionError('HTTP step requires a URL.');
  const method = typeof config.method === 'string' ? config.method.toUpperCase() : 'GET';
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
    throw new RunbookDefinitionError('Unsupported HTTP method.');
  const controller = new AbortController();
  const remainingMs = deadlineAt.getTime() - Date.now();
  if (remainingMs <= 0) throw new RunbookDefinitionError('Execution deadline has expired.');
  const timer = setTimeout(
    () => controller.abort(),
    Math.min((step.timeoutSeconds ?? DEFAULT_STEP_TIMEOUT_SECONDS) * 1000, remainingMs)
  );
  try {
    const response = await safeOutboundFetch(config.url, {
      method,
      headers:
        typeof config.headers === 'object' && config.headers
          ? (config.headers as Record<string, string>)
          : undefined,
      body:
        config.body === undefined
          ? undefined
          : typeof config.body === 'string'
            ? config.body
            : JSON.stringify(config.body),
      signal: controller.signal,
      redirect: 'error',
    });
    const body = (await response.text()).slice(0, MAX_OUTPUT_PREVIEW_BYTES);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 512)}`);
    return `HTTP ${response.status}\n${body}`;
  } finally {
    clearTimeout(timer);
  }
}

async function processCurrentStep(executionId: string, step: RunbookExecutionStep) {
  if (step.requiresApproval && !step.approvedAt) {
    await prisma.$transaction(async tx => {
      const changed = await tx.runbookExecutionStep.updateMany({
        where: { id: step.id, status: 'READY' },
        data: { status: 'WAITING_APPROVAL' },
      });
      if (changed.count !== 1) return;
      const execution = await tx.runbookExecution.update({
        where: { id: executionId },
        data: { status: 'WAITING_APPROVAL' },
        select: { incidentId: true },
      });
      await addIncidentRunbookEvent(
        tx,
        execution.incidentId,
        'RUNBOOK_APPROVAL_REQUIRED',
        `Runbook approval required: ${step.name}`
      );
    });
    return;
  }
  if (step.type === 'APPROVAL' || step.type === 'MANUAL') {
    await completeStep(executionId, step.id, 'SUCCEEDED', 'Approved by responder.');
    return;
  }
  if (step.type === 'WAIT') {
    const execution = await prisma.runbookExecution.findUniqueOrThrow({
      where: { id: executionId },
      select: { deadlineAt: true },
    });
    const seconds = Number((step.config as Record<string, unknown>).durationSeconds ?? 0);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400)
      throw new RunbookDefinitionError('Wait duration must be between 0 and 86400 seconds.');
    if (!step.startedAt) {
      await prisma.$transaction(async tx => {
        const claimed = await tx.runbookExecutionStep.updateMany({
          where: { id: step.id, status: 'READY' },
          data: { status: 'RUNNING', startedAt: new Date() },
        });
        if (claimed.count !== 1) return;
        await enqueueAdvance(
          tx,
          executionId,
          new Date(Math.min(Date.now() + seconds * 1000, execution.deadlineAt.getTime()))
        );
      });
      return;
    }
    if (Date.now() < step.startedAt.getTime() + seconds * 1000) return;
    await completeStep(executionId, step.id, 'SUCCEEDED', `Waited ${seconds} seconds.`);
    return;
  }
  if (step.type === 'CONDITION') {
    const execution = await prisma.runbookExecution.findUniqueOrThrow({
      where: { id: executionId },
      select: {
        inputValues: true,
        incident: {
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            urgency: true,
            priority: true,
            tags: { select: { tag: { select: { name: true } } } },
          },
        },
        service: { select: { id: true, name: true, teamId: true } },
      },
    });
    const config = workflowConditionSchema.parse(step.config);
    const matched = matchesCondition(
      {
        input: execution.inputValues,
        incident: execution.incident
          ? { ...execution.incident, tags: execution.incident.tags.map(item => item.tag.name) }
          : null,
        service: execution.service,
      },
      {
        field: config.field,
        operator: config.operator,
        value: config.value,
      }
    );
    await prisma.$transaction(async tx => {
      const completedAt = new Date();
      const completed = await tx.runbookExecutionStep.updateMany({
        where: { id: step.id, executionId, status: 'READY' },
        data: {
          status: matched ? 'SUCCEEDED' : 'SKIPPED',
          completedAt,
          outputPreview: matched ? 'Condition matched.' : 'Condition did not match.',
        },
      });
      if (completed.count !== 1) return;
      if (!matched) {
        await tx.runbookExecutionStep.updateMany({
          where: { executionId, sequence: { gt: step.sequence }, status: 'PENDING' },
          data: {
            status: 'SKIPPED',
            completedAt,
            outputPreview: 'Skipped by condition.',
          },
        });
      }
      await tx.runbookExecution.update({
        where: { id: executionId },
        data: { status: 'RUNNING' },
      });
      await enqueueAdvance(tx, executionId);
    });
    return;
  }
  if (step.type === 'HTTP') {
    const execution = await prisma.runbookExecution.findUniqueOrThrow({
      where: { id: executionId },
      select: { deadlineAt: true, inputValues: true },
    });
    const config = resolveInputTemplates(
      step.config,
      execution.inputValues as Record<string, unknown>
    ) as Record<string, unknown>;
    if (containsSecretReference(config)) {
      throw new RunbookDefinitionError(
        'HTTP steps cannot consume secret references; use a scoped execution Agent.'
      );
    }
    const claimed = await prisma.runbookExecutionStep.updateMany({
      where: { id: step.id, status: 'READY' },
      data: { status: 'RUNNING', startedAt: new Date(), attemptCount: { increment: 1 } },
    });
    if (claimed.count !== 1) return;
    const output = await executeHttpStep(step, config, execution.deadlineAt);
    await completeStep(executionId, step.id, 'SUCCEEDED', output);
    return;
  }

  const execution = await prisma.runbookExecution.findUniqueOrThrow({
    where: { id: executionId },
    select: {
      definitionChecksum: true,
      inputValues: true,
      resolvedTargetAgentId: true,
      resolvedTargetAgentPoolId: true,
    },
  });
  const planDigest = resolvedPlanDigest(step, execution);
  await prisma.$transaction(async tx => {
    const claimed = await tx.runbookExecutionStep.updateMany({
      where: { id: step.id, status: 'READY' },
      data: { status: 'WAITING_AGENT', startedAt: step.startedAt ?? new Date() },
    });
    if (claimed.count !== 1) return;
    await tx.runbookStepAttempt.create({
      data: {
        executionStepId: step.id,
        attemptNumber: 1,
        status: 'PENDING',
        requiresConfidentialTransport: Object.entries(
          execution.inputValues as Record<string, unknown>
        ).some(
          ([key, value]) =>
            referencedStepInputKeys(step.config).has(key) && isSecretReference(value)
        ),
        targetAgentId: execution.resolvedTargetAgentId,
        targetAgentPoolId: execution.resolvedTargetAgentPoolId,
        claimDeadlineAt: new Date(Date.now() + 300_000),
        idempotencyKey: crypto.randomUUID(),
        planDigest,
      },
    });
    await tx.runbookExecution.update({
      where: { id: executionId },
      data: { status: 'WAITING_AGENT' },
    });
  });
}

async function completeStep(
  executionId: string,
  stepId: string,
  status: 'SUCCEEDED' | 'SKIPPED',
  outputPreview: string
) {
  await prisma.$transaction(async tx => {
    const completed = await tx.runbookExecutionStep.updateMany({
      where: { id: stepId, executionId, status: { in: ['READY', 'RUNNING'] } },
      data: {
        status,
        completedAt: new Date(),
        outputPreview: outputPreview.slice(0, MAX_OUTPUT_PREVIEW_BYTES),
      },
    });
    if (completed.count !== 1) return;
    await tx.runbookExecution.update({
      where: { id: executionId },
      data: { status: 'RUNNING' },
    });
    await enqueueAdvance(tx, executionId);
  });
}

export async function advanceExecution(executionId: string): Promise<void> {
  const execution = await prisma.runbookExecution.findUnique({
    where: { id: executionId },
    include: { steps: { orderBy: { sequence: 'asc' } } },
  });
  if (!execution) throw new RunbookExecutionNotFoundError(executionId);
  if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(execution.status)) return;
  if (execution.cancelRequestedAt || execution.status === 'CANCEL_REQUESTED') {
    await prisma.$transaction(async tx => {
      await tx.runbookStepAttempt.updateMany({
        where: {
          executionStep: { executionId },
          status: { in: ['PENDING', 'CLAIMED'] },
        },
        data: {
          status: 'CANCELLED',
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await tx.runbookExecutionStep.updateMany({
        where: {
          executionId,
          status: { in: ['PENDING', 'READY', 'WAITING_APPROVAL', 'WAITING_AGENT'] },
        },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      const active = await tx.runbookStepAttempt.count({
        where: { executionStep: { executionId }, status: 'RUNNING' },
      });
      if (active === 0) {
        const cancelled = await tx.runbookExecution.updateMany({
          where: { id: executionId, status: 'CANCEL_REQUESTED' },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });
        if (cancelled.count === 1) {
          await addIncidentRunbookEvent(
            tx,
            execution.incidentId,
            'RUNBOOK_CANCELLED',
            'Runbook execution cancelled.'
          );
        }
      }
    });
    return;
  }
  if (execution.deadlineAt <= new Date()) {
    await prisma.$transaction(async tx => {
      await tx.runbookStepAttempt.updateMany({
        where: {
          executionStep: { executionId },
          status: { in: ['PENDING', 'CLAIMED'] },
        },
        data: {
          status: 'TIMED_OUT',
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await tx.runbookExecutionStep.updateMany({
        where: {
          executionId,
          status: { in: ['PENDING', 'READY', 'WAITING_APPROVAL', 'WAITING_AGENT'] },
        },
        data: { status: 'CANCELLED', completedAt: new Date(), errorCode: 'EXECUTION_TIMEOUT' },
      });
      const timedOut = await tx.runbookExecution.updateMany({
        where: {
          id: executionId,
          status: { notIn: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] },
        },
        data: { status: 'TIMED_OUT', completedAt: new Date(), failureCode: 'EXECUTION_TIMEOUT' },
      });
      if (timedOut.count === 1) {
        await addIncidentRunbookEvent(
          tx,
          execution.incidentId,
          'RUNBOOK_FAILED',
          'Runbook execution timed out.'
        );
      }
    });
    return;
  }
  const failed = execution.steps.find(
    step => step.status === 'FAILED' || step.status === 'UNKNOWN'
  );
  if (failed) {
    await prisma.$transaction(async tx => {
      const changed = await tx.runbookExecution.updateMany({
        where: {
          id: executionId,
          status: { notIn: ['FAILED', 'SUCCEEDED', 'CANCELLED', 'TIMED_OUT'] },
        },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          failureCode: failed.errorCode ?? 'STEP_FAILED',
          failureMessage: failed.errorMessage,
        },
      });
      if (changed.count === 1) {
        await addIncidentRunbookEvent(
          tx,
          execution.incidentId,
          'RUNBOOK_FAILED',
          `Runbook failed at step: ${failed.name}`
        );
        await finalizeVerificationEvidence(tx, executionId);
      }
    });
    return;
  }
  const current = execution.steps.find(step => !TERMINAL_STEP.has(step.status));
  if (!current) {
    await prisma.$transaction(async tx => {
      const changed = await tx.runbookExecution.updateMany({
        where: {
          id: executionId,
          status: { notIn: ['FAILED', 'SUCCEEDED', 'CANCELLED', 'TIMED_OUT'] },
        },
        data: { status: 'SUCCEEDED', completedAt: new Date() },
      });
      if (changed.count === 1) {
        await addIncidentRunbookEvent(
          tx,
          execution.incidentId,
          'RUNBOOK_COMPLETED',
          'Runbook execution completed.'
        );
        await finalizeVerificationEvidence(tx, executionId);
      }
    });
    return;
  }
  if (['WAITING_AGENT', 'WAITING_APPROVAL'].includes(current.status)) return;
  if (current.status === 'RUNNING' && current.type !== 'WAIT') return;
  let owned = current;
  if (current.status === 'PENDING') {
    const claimed = await prisma.runbookExecutionStep.updateMany({
      where: { id: current.id, executionId, status: 'PENDING' },
      data: { status: 'READY' },
    });
    if (claimed.count !== 1) return;
    owned = { ...current, status: 'READY' };
  }
  await prisma.runbookExecution.update({
    where: { id: executionId },
    data: { status: 'RUNNING', startedAt: execution.startedAt ?? new Date() },
  });
  try {
    await processCurrentStep(executionId, owned);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Step failed.';
    const errorCode = error instanceof RunbookDefinitionError ? 'INVALID_CONFIG' : 'STEP_FAILED';
    await prisma.$transaction(async tx => {
      const latest = await tx.runbookExecutionStep.findUnique({ where: { id: current.id } });
      if (!latest || !['READY', 'RUNNING'].includes(latest.status)) return;
      const retry =
        isRetryable(latest.riskClass) &&
        isRetryableFailure(latest.riskClass, errorCode) &&
        latest.attemptCount <= latest.maxRetries;
      const ambiguousWrite =
        latest.status === 'RUNNING' &&
        latest.riskClass !== 'READ_ONLY' &&
        errorCode !== 'INVALID_CONFIG';
      const changed = await tx.runbookExecutionStep.updateMany({
        where: { id: current.id, status: latest.status },
        data: ambiguousWrite
          ? {
              status: 'UNKNOWN',
              completedAt: new Date(),
              errorCode: 'LOCAL_STEP_OUTCOME_UNKNOWN',
              errorMessage: message,
            }
          : retry
            ? {
                status: 'PENDING',
                startedAt: null,
                errorCode: 'STEP_RETRY_SCHEDULED',
                errorMessage: message,
              }
            : {
                status: 'FAILED',
                completedAt: new Date(),
                errorCode,
                errorMessage: message,
              },
      });
      if (changed.count === 1) {
        const delay = retry ? retryDelayMs(latest.attemptCount) : 0;
        await enqueueAdvance(tx, executionId, new Date(Date.now() + delay));
      }
    });
  }
}

export async function approveExecutionStep(input: {
  executionId: string;
  stepId: string;
  planDigest: string;
  actorId: string;
}) {
  return prisma.$transaction(async tx => {
    const step = await tx.runbookExecutionStep.findFirst({
      where: { id: input.stepId, executionId: input.executionId },
      include: {
        execution: {
          select: {
            definitionChecksum: true,
            inputValues: true,
            resolvedTargetAgentId: true,
            resolvedTargetAgentPoolId: true,
            incidentId: true,
          },
        },
      },
    });
    if (!step) throw new RunbookExecutionNotFoundError(input.executionId);
    if (step.status !== 'WAITING_APPROVAL')
      throw new RunbookExecutionInvalidTransitionError(input.executionId, step.status, 'READY');
    const expected = resolvedPlanDigest(step, step.execution);
    if (expected !== input.planDigest) throw new RunbookApprovalPlanChangedError(step.id);
    const approved = await tx.runbookExecutionStep.updateMany({
      where: { id: step.id, executionId: input.executionId, status: 'WAITING_APPROVAL' },
      data: {
        status: 'PENDING',
        approvedAt: new Date(),
        approvedById: input.actorId,
        approvedPlanDigest: expected,
      },
    });
    if (approved.count !== 1) {
      throw new RunbookExecutionInvalidTransitionError(input.executionId, step.status, 'READY');
    }
    await tx.runbookExecution.update({
      where: { id: input.executionId },
      data: { status: 'RUNNING' },
    });
    await enqueueAdvance(tx, input.executionId);
    await addIncidentRunbookEvent(
      tx,
      step.execution.incidentId,
      'RUNBOOK_APPROVED',
      `Runbook step approved: ${step.name}`
    );
    await logAudit(
      {
        action: 'runbook.execution.step.approved',
        entityType: 'RUNBOOK_EXECUTION',
        entityId: input.executionId,
        actorId: input.actorId,
        details: { stepId: step.id, planDigest: expected },
      },
      tx
    );
    return step;
  });
}

export async function cancelExecution(executionId: string, actorId: string, reason?: string) {
  const result = await prisma.runbookExecution.updateMany({
    where: {
      id: executionId,
      status: { notIn: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] },
    },
    data: { status: 'CANCEL_REQUESTED', cancelRequestedAt: new Date(), failureMessage: reason },
  });
  if (result.count !== 1)
    throw new RunbookExecutionInvalidTransitionError(executionId, 'TERMINAL', 'CANCEL_REQUESTED');
  await prisma.$transaction(async tx => {
    await enqueueAdvance(tx, executionId);
    await logAudit(
      {
        action: 'runbook.execution.cancel.requested',
        entityType: 'RUNBOOK_EXECUTION',
        entityId: executionId,
        actorId,
        details: { reason: reason ?? null },
      },
      tx
    );
  });
}

export async function processRunbookJob(raw: unknown): Promise<void> {
  const payload = jobPayloadSchema.parse(raw);
  if (payload.kind === 'ADVANCE_EXECUTION' || payload.kind === 'RECONCILE_EXECUTION') {
    await advanceExecution(payload.executionId);
    return;
  }
  const { evaluateIncidentTriggers } = await import('./triggers');
  await evaluateIncidentTriggers(payload.incidentId, payload.sourceEventId);
}
