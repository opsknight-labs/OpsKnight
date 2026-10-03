import 'server-only';

import crypto from 'crypto';
import type { Prisma, RunbookExecutionStep } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { safeOutboundFetch } from '@/lib/network-security';
import { computePlanDigest, parseRunbookDefinition } from './definition';
import { matchesCondition } from './matcher';
import {
  DEFAULT_EXECUTION_TIMEOUT_SECONDS,
  DEFAULT_STEP_TIMEOUT_SECONDS,
  MAX_OUTPUT_PREVIEW_BYTES,
  type RunbookStepDefinition,
} from './types';
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

function executionSteps(definition: ReturnType<typeof parseRunbookDefinition>) {
  const rows: Array<RunbookStepDefinition & { sequence: number }> = [];
  for (const step of definition.steps) {
    for (const precheck of step.precheck?.steps ?? [])
      rows.push({ ...precheck, sequence: rows.length });
    rows.push({ ...step, sequence: rows.length });
    for (const verification of step.verification?.steps ?? [])
      rows.push({ ...verification, sequence: rows.length });
  }
  return rows;
}

export async function startRunbookExecution(input: {
  runbookId: string;
  runbookVersionId?: string;
  serviceId?: string;
  incidentId?: string;
  bindingId?: string;
  inputValues?: Record<string, unknown>;
  triggeredByUserId?: string;
  triggerFingerprint?: string;
}) {
  return prisma.$transaction(async tx => {
    const runbook = await tx.runbook.findFirst({
      where: { id: input.runbookId, archivedAt: null },
      include: { publishedVersion: true },
    });
    if (!runbook) throw new RunbookDefinitionError('Runbook not found or archived.');
    const versionId = input.runbookVersionId ?? runbook.publishedVersionId;
    if (!versionId) throw new RunbookDefinitionError('Runbook must be published before execution.');
    const version = await tx.runbookVersion.findFirst({
      where: { id: versionId, runbookId: runbook.id, state: 'PUBLISHED' },
    });
    if (!version)
      throw new RunbookDefinitionError('Only an immutable published version can execute.');
    const definition = parseRunbookDefinition(version.definition);
    const steps = executionSteps(definition);
    const execution = await tx.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        serviceId: input.serviceId,
        incidentId: input.incidentId,
        bindingId: input.bindingId,
        triggerFingerprint: input.triggerFingerprint,
        triggeredByType: input.triggeredByUserId ? 'USER' : 'TRIGGER',
        triggeredByUserId: input.triggeredByUserId,
        inputValues: asJson(input.inputValues ?? {}),
        definitionChecksum: version.checksum,
        steps: {
          create: steps.map(step => ({
            stepKey: step.key,
            sequence: step.sequence,
            name: step.name,
            type: step.type,
            riskClass: step.riskClass,
            config: asJson(step.config),
            requiresApproval:
              step.type === 'APPROVAL' || step.type === 'MANUAL' || step.requiresApproval === true,
            timeoutSeconds:
              step.timeoutSeconds ??
              definition.defaultTimeoutSeconds ??
              DEFAULT_STEP_TIMEOUT_SECONDS,
            maxRetries: step.maxRetries ?? definition.defaultMaxRetries ?? 0,
          })),
        },
      },
    });
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
          serviceId: input.serviceId ?? null,
        },
      },
      tx
    );
    return execution;
  });
}

function resolvedPlanDigest(
  step: RunbookExecutionStep,
  execution: { definitionChecksum: string; inputValues: Prisma.JsonValue },
  attemptAgentPoolId?: string | null
) {
  return computePlanDigest({
    stepKey: step.stepKey,
    stepType: step.type,
    riskClass: step.riskClass,
    config: step.config as Record<string, unknown>,
    agentPoolId: attemptAgentPoolId ?? undefined,
    inputValues: execution.inputValues as Record<string, unknown>,
    versionChecksum: execution.definitionChecksum,
  });
}

async function executeHttpStep(step: RunbookExecutionStep): Promise<string> {
  const config = step.config as Record<string, unknown>;
  if (typeof config.url !== 'string') throw new RunbookDefinitionError('HTTP step requires a URL.');
  const method = typeof config.method === 'string' ? config.method.toUpperCase() : 'GET';
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
    throw new RunbookDefinitionError('Unsupported HTTP method.');
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    (step.timeoutSeconds ?? DEFAULT_STEP_TIMEOUT_SECONDS) * 1000
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
    await prisma.$transaction([
      prisma.runbookExecutionStep.updateMany({
        where: { id: step.id, status: 'PENDING' },
        data: { status: 'WAITING_APPROVAL' },
      }),
      prisma.runbookExecution.update({
        where: { id: executionId },
        data: { status: 'WAITING_APPROVAL' },
      }),
    ]);
    return;
  }
  if (step.type === 'APPROVAL' || step.type === 'MANUAL') {
    await completeStep(executionId, step.id, 'SUCCEEDED', 'Approved by responder.');
    return;
  }
  if (step.type === 'WAIT') {
    const seconds = Number((step.config as Record<string, unknown>).durationSeconds ?? 0);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400)
      throw new RunbookDefinitionError('Wait duration must be between 0 and 86400 seconds.');
    if (!step.startedAt) {
      await prisma.$transaction(async tx => {
        await tx.runbookExecutionStep.update({
          where: { id: step.id },
          data: { status: 'RUNNING', startedAt: new Date() },
        });
        await enqueueAdvance(tx, executionId, new Date(Date.now() + seconds * 1000));
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
      select: { inputValues: true },
    });
    const config = step.config as Record<string, unknown>;
    const matched = matchesCondition(
      { input: execution.inputValues },
      {
        field: String(config.field ?? ''),
        operator: String(config.operator ?? 'EQUALS') as never,
        value: config.value,
      }
    );
    await completeStep(
      executionId,
      step.id,
      matched ? 'SUCCEEDED' : 'SKIPPED',
      matched ? 'Condition matched.' : 'Condition did not match.'
    );
    return;
  }
  if (step.type === 'HTTP') {
    await prisma.runbookExecutionStep.update({
      where: { id: step.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    const output = await executeHttpStep(step);
    await completeStep(executionId, step.id, 'SUCCEEDED', output);
    return;
  }

  const execution = await prisma.runbookExecution.findUniqueOrThrow({
    where: { id: executionId },
    select: {
      definitionChecksum: true,
      inputValues: true,
      binding: { select: { defaultAgentPoolId: true, defaultAgentId: true } },
    },
  });
  const planDigest = resolvedPlanDigest(step, execution, execution.binding?.defaultAgentPoolId);
  await prisma.$transaction(async tx => {
    await tx.runbookExecutionStep.update({
      where: { id: step.id },
      data: { status: 'WAITING_AGENT', startedAt: step.startedAt ?? new Date() },
    });
    await tx.runbookStepAttempt.create({
      data: {
        executionStepId: step.id,
        attemptNumber: 1,
        status: 'PENDING',
        agentId: execution.binding?.defaultAgentId,
        agentPoolId: execution.binding?.defaultAgentPoolId,
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
    await tx.runbookExecutionStep.update({
      where: { id: stepId },
      data: {
        status,
        completedAt: new Date(),
        outputPreview: outputPreview.slice(0, MAX_OUTPUT_PREVIEW_BYTES),
      },
    });
    await tx.runbookExecution.update({ where: { id: executionId }, data: { status: 'RUNNING' } });
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
    await prisma.$transaction([
      prisma.runbookExecutionStep.updateMany({
        where: {
          executionId,
          status: { in: ['PENDING', 'READY', 'WAITING_APPROVAL', 'WAITING_AGENT'] },
        },
        data: { status: 'CANCELLED', completedAt: new Date() },
      }),
      prisma.runbookExecution.update({
        where: { id: executionId },
        data: { status: 'CANCELLED', completedAt: new Date() },
      }),
    ]);
    return;
  }
  const timeout = DEFAULT_EXECUTION_TIMEOUT_SECONDS * 1000;
  if (execution.startedAt && Date.now() - execution.startedAt.getTime() > timeout) {
    await prisma.runbookExecution.update({
      where: { id: executionId },
      data: { status: 'TIMED_OUT', completedAt: new Date(), failureCode: 'EXECUTION_TIMEOUT' },
    });
    return;
  }
  const failed = execution.steps.find(
    step => step.status === 'FAILED' || step.status === 'UNKNOWN'
  );
  if (failed) {
    await prisma.runbookExecution.update({
      where: { id: executionId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        failureCode: failed.errorCode ?? 'STEP_FAILED',
        failureMessage: failed.errorMessage,
      },
    });
    return;
  }
  const current = execution.steps.find(step => !TERMINAL_STEP.has(step.status));
  if (!current) {
    await prisma.runbookExecution.update({
      where: { id: executionId },
      data: { status: 'SUCCEEDED', completedAt: new Date() },
    });
    return;
  }
  if (['WAITING_AGENT', 'WAITING_APPROVAL'].includes(current.status)) return;
  await prisma.runbookExecution.update({
    where: { id: executionId },
    data: { status: 'RUNNING', startedAt: execution.startedAt ?? new Date() },
  });
  try {
    await processCurrentStep(executionId, current);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Step failed.';
    await prisma.$transaction(async tx => {
      await tx.runbookExecutionStep.update({
        where: { id: current.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorCode: 'STEP_EXECUTION_FAILED',
          errorMessage: message,
        },
      });
      await enqueueAdvance(tx, executionId);
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
          include: { binding: { select: { defaultAgentPoolId: true } } },
        },
      },
    });
    if (!step) throw new RunbookExecutionNotFoundError(input.executionId);
    if (step.status !== 'WAITING_APPROVAL')
      throw new RunbookExecutionInvalidTransitionError(input.executionId, step.status, 'READY');
    const expected = resolvedPlanDigest(
      step,
      step.execution,
      step.execution.binding?.defaultAgentPoolId
    );
    if (expected !== input.planDigest) throw new RunbookApprovalPlanChangedError(step.id);
    await tx.runbookExecutionStep.update({
      where: { id: step.id },
      data: {
        status: 'PENDING',
        approvedAt: new Date(),
        approvedById: input.actorId,
        approvedPlanDigest: expected,
      },
    });
    await tx.runbookExecution.update({
      where: { id: input.executionId },
      data: { status: 'RUNNING' },
    });
    await enqueueAdvance(tx, input.executionId);
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
