import 'server-only';

import crypto from 'crypto';
import { buildExecutionPreview, checkExecutionReadiness } from './execution-preview';
import type { IncidentEventType, Prisma, RunbookExecutionStep } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { safeOutboundFetch } from '@/lib/network-security';
import {
  computePlanDigest,
  computeDefinitionChecksum,
  computeTriggerFingerprint,
  containsSecretReference,
  referencedStepInputKeys,
  isSecretReference,
  flattenSteps,
  parseRunbookDefinition,
  resolveInputTemplates,
  validateResolvedStepConfig,
} from './definition';
import { evaluateTrigger, matchesCondition } from './matcher';
import { automationContextFields, loadRunbookIncidentContext } from './incident-context';
import {
  approvedBindingTargets,
  resolveBindingAutomationPlan,
  type InputProvenance,
  type TargetProvenance,
} from './automation-binding';
import {
  readIncidentResponseContext,
  type IncidentResponseContext,
} from '@/lib/automation/response-context';
import { redactRunbookDisplayName } from './display-name';
import { finalizeExecutionDeadline } from './deadline';
import { enqueueVerificationEvidence, finalizeVerificationEvidence } from './verification-evidence';
import { processVerifiedResolution, recordRecoveryVerification } from './recovery';
import { workflowConditionSchema } from './conditions';
import { fenceAutomaticRemediation } from './remediation-fence';
import {
  applyRunbookInputDefaults,
  bindingAuthorizesUnattendedWrites,
  computeRuleUnattendedScope,
  validateBindingInputValues,
} from './bindings';
import { suggestionPlanSchema } from './suggestion-plan';
import {
  DEFAULT_EXECUTION_TIMEOUT_SECONDS,
  DEFAULT_STEP_TIMEOUT_SECONDS,
  CIRCUIT_BREAKER_FAIL_THRESHOLD,
  MAX_AUTO_WRITE_ACTIONS_PER_SERVICE,
  MAX_CONCURRENT_WRITE_ACTIONS_PER_POOL,
  MAX_OUTPUT_PREVIEW_BYTES,
  isRetryable,
  isTerminalStepStatus,
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
import { lockRunbookForShare } from './locking';
import { assertIndependentPreviewReview } from './preview-review';

const jobPayloadSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('FINALIZE_VERIFICATION'),
      executionId: z.string().cuid(),
      revision: z.number().int().positive().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('ADVANCE_EXECUTION'), executionId: z.string().cuid() }).strict(),
  z.object({ kind: z.literal('RECONCILE_EXECUTION'), executionId: z.string().cuid() }).strict(),
  z.object({ kind: z.literal('VERIFIED_RESOLUTION'), executionId: z.string().cuid() }).strict(),
  z
    .object({
      kind: z.literal('EVALUATE_TRIGGER'),
      incidentId: z.string().cuid(),
      sourceEventId: z.string().min(1).max(200),
      source: z.string().max(40).optional(),
    })
    .strict(),
]);

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

/** Server-supplied provenance; never part of the executable request or preview digest. */
export interface RunbookExecutionAuditContext {
  apiClientId: string;
  /** Server-only provenance. Never accepted from executable request bodies. */
  independentPreview?: { grantId: string; credentialId: string };
}

export interface RunbookExecutionRequest {
  runbookId: string;
  runbookVersionId?: string;
  serviceId?: string;
  incidentId?: string;
  bindingId?: string;
  suggestionId?: string;
  inputValues?: Record<string, unknown>;
  triggeredByUserId?: string;
  triggerFingerprint?: string;
  expectedRuleRevision?: number;
  triggerId?: string;
  sourceEventId?: string;
  expectedPlanDigest?: string;
  previewAuthorizationToken?: string;
  evaluationSource?: 'MONITORING' | 'MANUAL';
  /** Responder-selected target; only accepted for manual runs without a rule or suggestion. */
  targetAgentId?: string;
  targetAgentPoolId?: string;
}

/** Responder entry point. Absence of an actor never authorizes an automatic execution. */
export async function startRunbookExecution(
  input: RunbookExecutionRequest,
  externalTx?: Prisma.TransactionClient,
  auditContext?: RunbookExecutionAuditContext
) {
  if (!input.triggeredByUserId || !input.expectedPlanDigest || !input.previewAuthorizationToken) {
    throw new RunbookDefinitionError(
      'PREVIEW_AUTHORIZATION_REQUIRED: An authorized responder and preview are required.'
    );
  }
  const result = await prepareRunbookExecution(input, false, 'MANUAL', externalTx, auditContext);
  if (!('id' in result)) throw new Error('Execution was not created.');
  return result;
}

const automaticExecutionSchema = z
  .object({
    runbookId: z.string().cuid(),
    runbookVersionId: z.string().cuid(),
    incidentId: z.string().cuid(),
    serviceId: z.string().cuid(),
    bindingId: z.string().cuid(),
    triggerId: z.string().cuid(),
    expectedRuleRevision: z.number().int().positive(),
    triggerFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sourceEventId: z.string().min(1).max(200),
    inputValues: z.record(z.string(), z.unknown()).optional(),
    evaluationSource: z.enum(['MONITORING', 'MANUAL']).optional(),
  })
  .strict();

/** Internal trigger entry point; the transaction verifies the full automatic contract. */
export async function startTriggeredRunbookExecution(
  input: z.infer<typeof automaticExecutionSchema>
) {
  const request = automaticExecutionSchema.safeParse(input);
  if (!request.success)
    throw new RunbookDefinitionError(
      'AUTOMATION_NOT_AUTHORIZED: Complete automatic trigger metadata is required.'
    );
  if (request.data.triggerFingerprint !== computeTriggerFingerprint(request.data)) {
    throw new RunbookDefinitionError(
      'AUTOMATION_NOT_AUTHORIZED: Trigger fingerprint does not match its source event, binding and version.'
    );
  }
  const result = await prepareRunbookExecution(request.data, false, 'AUTOMATIC');
  if (!('id' in result)) throw new Error('Execution was not created.');
  return result;
}

/** Resolves the execution preflight and issues a responder-bound preview capability. */
export async function previewRunbookExecution(
  input: RunbookExecutionRequest,
  externalTx?: Prisma.TransactionClient,
  auditContext?: RunbookExecutionAuditContext
) {
  if (!input.triggeredByUserId)
    throw new RunbookDefinitionError(
      'PREVIEW_AUTHORIZATION_REQUIRED: An authorized responder is required.'
    );
  const result = await prepareRunbookExecution(input, true, 'MANUAL', externalTx, auditContext);
  if (!('digest' in result)) throw new Error('Preview was not generated.');
  return result;
}

export const INCIDENT_NOT_OPEN = 'INCIDENT_NOT_OPEN';

/**
 * Takes the same row lock the lifecycle UPDATE takes (FOR NO KEY UPDATE), so automatic
 * runbook starts and lifecycle transitions serialize. Must be the first lock in the transaction.
 */
export async function lockOpenIncidentForAutomation(
  tx: Prisma.TransactionClient,
  incidentId: string
): Promise<{ open: true } | { open: false; reason: string }> {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT "status"::text AS "status" FROM "Incident" WHERE "id" = ${incidentId} FOR NO KEY UPDATE
  `;
  const status = rows[0]?.status;
  if (status === 'OPEN') return { open: true };
  return { open: false, reason: `${INCIDENT_NOT_OPEN}: incident is ${status ?? 'missing'}` };
}

async function prepareRunbookExecution(
  input: RunbookExecutionRequest,
  previewOnly: boolean,
  mode: 'MANUAL' | 'AUTOMATIC',
  externalTx?: Prisma.TransactionClient,
  auditContext?: RunbookExecutionAuditContext
) {
  const runner = async (tx: Prisma.TransactionClient) => {
    if (mode === 'AUTOMATIC') {
      if (!input.incidentId)
        throw new RunbookDefinitionError(
          'AUTOMATION_NOT_AUTHORIZED: Incident, service and matching enabled trigger are required.'
        );
      const incidentLock = await lockOpenIncidentForAutomation(tx, input.incidentId);
      if (!incidentLock.open) throw new RunbookDefinitionError(incidentLock.reason);
    }
    await lockRunbookForShare(tx, input.runbookId, { action: 'execute' });
    const runbook = await tx.runbook.findFirst({
      where: { id: input.runbookId, archivedAt: null },
      include: { publishedVersion: true },
    });
    if (!runbook) throw new RunbookDefinitionError('Runbook not found or archived.');
    // Retain the rule lock through execution creation, fencing pause/edit/detach.
    if (input.bindingId)
      await tx.$queryRaw`SELECT id FROM "ServiceRunbookBinding" WHERE id = ${input.bindingId} AND "runbookId" = ${input.runbookId} FOR SHARE`;
    const binding = input.bindingId
      ? await tx.serviceAutomationRule.findFirst({
          where: {
            id: input.bindingId,
            runbookId: runbook.id,
            enabled: true,
            detachedAt: null,
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
    // Verified automation context is read once per execution and reused for targeting/snapshot.
    let verifiedResponseContext: IncidentResponseContext | null | undefined;
    const readVerifiedResponseContext = async () => {
      if (verifiedResponseContext === undefined) {
        const read = input.incidentId
          ? await readIncidentResponseContext(tx, input.incidentId)
          : null;
        verifiedResponseContext = read?.status === 'AVAILABLE' ? read.context : null;
      }
      return verifiedResponseContext;
    };
    let matchReason: string | null = null;
    let evaluatedTriggerRevision: number | null = null;
    if (mode === 'AUTOMATIC') {
      if (
        !binding ||
        binding.mode !== 'AUTOMATIC' ||
        binding.versionStrategy !== 'PINNED' ||
        binding.runbookVersionId !== input.runbookVersionId ||
        binding.configurationRevision !== input.expectedRuleRevision ||
        (input.evaluationSource === 'MONITORING' && !binding.runOnMonitoringIncidents)
      ) {
        throw new RunbookDefinitionError(
          'AUTOMATION_NOT_AUTHORIZED: An enabled AUTOMATIC binding pinned to this version is required.'
        );
      }
      const trigger = await tx.runbookTrigger.findFirst({
        where: {
          id: input.triggerId,
          bindingId: binding.id,
          enabled: true,
          event: 'INCIDENT_CREATED',
        },
        include: { conditions: { orderBy: { sequence: 'asc' } } },
      });
      // Same loader and fail-closed matcher as trigger evaluation, so both see identical context.
      const loaded = input.incidentId
        ? await loadRunbookIncidentContext(tx, input.incidentId)
        : null;
      if (loaded) verifiedResponseContext = loaded.responseContext;
      const evaluation =
        trigger && loaded && loaded.trigger.service.id === binding.serviceId
          ? evaluateTrigger(loaded.trigger, trigger.conditions, trigger.conditionLogic)
          : null;
      if (!trigger || evaluation?.status !== 'MATCHED') {
        throw new RunbookDefinitionError(
          'AUTOMATION_NOT_AUTHORIZED: Incident, service and matching enabled trigger are required.'
        );
      }
      matchReason = evaluation.reason;
      evaluatedTriggerRevision = trigger.revision;
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
    // AUTOMATIC executions resolve context-mapped inputs and approved targets from the
    // verified context inside this transaction; suggestions reuse their frozen plan.
    const targetOverride = Boolean(input.targetAgentId || input.targetAgentPoolId);
    if (targetOverride) {
      if (mode !== 'MANUAL' || binding || planSnapshot || !input.triggeredByUserId)
        throw new RunbookDefinitionError(
          'TARGET_OVERRIDE_NOT_ALLOWED: service rules and suggestions use their reviewed target.'
        );
      if (input.targetAgentId && input.targetAgentPoolId)
        throw new RunbookDefinitionError(
          'Select either a specific Agent or an Agent pool, not both.'
        );
      const target = input.targetAgentId
        ? await tx.runbookAgent.findFirst({
            where: { id: input.targetAgentId, status: { not: 'REVOKED' } },
            select: { id: true },
          })
        : await tx.runbookAgentPool.findUnique({
            where: { id: input.targetAgentPoolId, lifecycle: 'ACTIVE' },
            select: { id: true },
          });
      if (!target)
        throw new RunbookDefinitionError(
          'TARGET_NOT_FOUND: the selected Agent or Agent pool is unavailable.'
        );
    }
    const automationPlan =
      mode === 'AUTOMATIC' && binding
        ? resolveBindingAutomationPlan({
            definitions: version.inputs,
            binding,
            context: automationContextFields(await readVerifiedResponseContext()),
          })
        : null;
    if (automationPlan && !automationPlan.ok)
      throw new RunbookDefinitionError(automationPlan.reason);
    const automaticPlan = automationPlan?.ok ? automationPlan : null;
    let resolvedTargetAgentId = automaticPlan
      ? automaticPlan.agentId
      : planSnapshot
        ? planSnapshot.agentId
        : (binding?.defaultAgentId ?? input.targetAgentId ?? null);
    const resolvedTargetAgentPoolId = automaticPlan
      ? automaticPlan.agentPoolId
      : planSnapshot
        ? planSnapshot.agentPoolId
        : (binding?.defaultAgentPoolId ?? input.targetAgentPoolId ?? null);
    const targetProvenance: TargetProvenance = automaticPlan
      ? automaticPlan.targetProvenance
      : planSnapshot
        ? ((planSnapshot.targetProvenance as TargetProvenance | undefined) ?? {
            kind: 'SUGGESTION_PLAN',
          })
        : targetOverride
          ? { kind: 'RESPONDER_SELECTED' }
          : resolvedTargetAgentId || resolvedTargetAgentPoolId
            ? { kind: 'BINDING_DEFAULT' }
            : { kind: 'NONE' };
    if (binding && targetProvenance.kind === 'CONTEXT_MAPPING') {
      // A context-selected target must still be approved by this service's binding.
      const approved = approvedBindingTargets(binding);
      if (
        (resolvedTargetAgentId && !approved.agentIds.has(resolvedTargetAgentId)) ||
        (resolvedTargetAgentPoolId && !approved.poolIds.has(resolvedTargetAgentPoolId))
      )
        throw new RunbookDefinitionError(
          'TARGET_NOT_AUTHORIZED: the selected Agent or Agent pool is not approved for this service binding.'
        );
    }
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
      automaticPlan
        ? automaticPlan.inputValues
        : planSnapshot
          ? planSnapshot.inputValues
          : binding
            ? (binding.inputValues as Record<string, unknown>)
            : (input.inputValues ?? {})
    );
    validateBindingInputValues(version.inputs, resolvedInputs);
    const plannedProvenance = (automaticPlan?.inputProvenance ??
      planSnapshot?.inputProvenance ??
      {}) as Record<string, InputProvenance>;
    const inputProvenance: Record<string, InputProvenance | { source: 'VERSION_DEFAULT' }> =
      Object.fromEntries(
        Object.keys(resolvedInputs).map(key => [
          key,
          (Object.getOwnPropertyDescriptor(plannedProvenance, key)?.value as
            InputProvenance | undefined) ??
            (binding ? { source: 'BINDING' } : { source: 'VERSION_DEFAULT' }),
        ])
      );
    if (targetProvenance.kind === 'CONTEXT_MAPPING') {
      // Dispatch-time eligibility through the existing readiness/capability checks.
      const readiness = await checkExecutionReadiness(tx, {
        steps,
        inputValues: resolvedInputs,
        agentId: resolvedTargetAgentId,
        agentPoolId: resolvedTargetAgentPoolId,
      });
      if (readiness.some(check => check.state === 'blocked'))
        throw new RunbookDefinitionError(
          'TARGET_NOT_ELIGIBLE: the approved target for this context value has no healthy, capable, authorized Agent.'
        );
    }
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
      // Serialized by the per-incident budget lock: one automatic execution per incident and binding.
      if (
        mode === 'AUTOMATIC' &&
        binding &&
        (await tx.runbookExecution.findFirst({
          where: { incidentId: input.incidentId, bindingId: binding.id, triggerId: { not: null } },
          select: { id: true },
        }))
      )
        throw new RunbookDefinitionError(
          'TRIGGER_ALREADY_HANDLED: this incident already started an automatic execution for the binding.'
        );
    }
    if (!input.triggeredByUserId && hasWriteAction) {
      if (!resolvedServiceId) {
        throw new RunbookDefinitionError('Automatic write runbooks require a service boundary.');
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runbook-service:${resolvedServiceId}`}))`;
      const newServiceWriteSlot = steps.some(step => step.riskClass !== 'READ_ONLY') ? 1 : 0;
      const activeServiceWrites = await tx.runbookExecution.count({
        where: {
          serviceId: resolvedServiceId,
          triggeredByUserId: null,
          status: {
            in: [
              'QUEUED',
              'RUNNING',
              'WAITING_AGENT',
              'WAITING_APPROVAL',
              'CANCEL_REQUESTED',
              'PAUSED',
            ],
          },
          steps: {
            some: {
              riskClass: { in: ['IDEMPOTENT_WRITE', 'NON_IDEMPOTENT'] },
              status: { in: ['PENDING', 'READY', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
            },
          },
        },
      });
      // Concurrency slot accounting: sequential executions reserve 1 workflow slot while holding active write steps.
      if (activeServiceWrites + newServiceWriteSlot > MAX_AUTO_WRITE_ACTIONS_PER_SERVICE) {
        throw new RunbookDefinitionError(
          'AUTOMATION_BLAST_RADIUS_LIMIT: too many automatic write runbooks are active for this service.'
        );
      }
      const recentFailures = await tx.runbookExecution.count({
        where: {
          serviceId: resolvedServiceId,
          status: { in: ['FAILED', 'TIMED_OUT'] },
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
      const newPoolWriteSlot = steps.some(
        step => requiresAgent(step.type) && step.riskClass !== 'READ_ONLY'
      )
        ? 1
        : 0;
      const activePoolWrites = await tx.runbookExecution.count({
        where: {
          OR: [
            { resolvedTargetAgentPoolId },
            { targetSelection: { path: ['sourcePoolId'], equals: resolvedTargetAgentPoolId } },
          ],
          status: {
            in: [
              'QUEUED',
              'RUNNING',
              'WAITING_AGENT',
              'WAITING_APPROVAL',
              'CANCEL_REQUESTED',
              'PAUSED',
            ],
          },
          steps: {
            some: {
              riskClass: { in: ['IDEMPOTENT_WRITE', 'NON_IDEMPOTENT'] },
              status: { in: ['PENDING', 'READY', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
            },
          },
        },
      });
      // Concurrency slot accounting: sequential executions reserve 1 workflow slot while holding active write steps in this pool.
      if (activePoolWrites + newPoolWriteSlot > MAX_CONCURRENT_WRITE_ACTIONS_PER_POOL) {
        throw new RunbookDefinitionError(
          'AGENT_POOL_CONCURRENCY_LIMIT: too many write actions are active for this Agent pool.'
        );
      }
    }
    // Hash precisely the live fields available to workflow conditions, plus the request scope.
    const incidentContext = input.incidentId
      ? await tx.incident.findUniqueOrThrow({
          where: { id: input.incidentId },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            urgency: true,
            priority: true,
            tags: { select: { tag: { select: { name: true } } } },
          },
        })
      : null;
    const serviceContext = resolvedServiceId
      ? await tx.service.findUniqueOrThrow({
          where: { id: resolvedServiceId },
          select: { id: true, name: true, teamId: true },
        })
      : null;
    const authorizationScope = {
      actorId: input.triggeredByUserId ?? null,
      runbookId: runbook.id,
      incidentId: input.incidentId ?? null,
      serviceId: resolvedServiceId ?? null,
      bindingId: input.bindingId ?? null,
      suggestionId: input.suggestionId ?? null,
    };
    const preview = buildExecutionPreview({
      authorizationContext: {
        ...authorizationScope,
        incident: incidentContext
          ? { ...incidentContext, tags: incidentContext.tags.map(item => item.tag.name).sort() }
          : null,
        service: serviceContext,
      },
      runbookId: runbook.id,
      versionId: version.id,
      version: version.version,
      checksum: version.checksum,
      agentId: resolvedTargetAgentId,
      agentPoolId: resolvedTargetAgentId ? null : resolvedTargetAgentPoolId,
      selectedLabels,
      sourceAgentPoolId: resolvedTargetAgentPoolId,
      timeoutSeconds: executionTimeoutSeconds,
      inputValues: resolvedInputs,
      inputTypes: version.inputs,
      steps,
    });
    if (
      input.expectedPlanDigest &&
      z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(input.expectedPlanDigest) !== preview.digest
    ) {
      throw new RunbookDefinitionError(
        'PREVIEW_STALE: version, inputs, target, responder or incident context changed. Preview the runbook again before executing.'
      );
    }
    if (previewOnly || input.expectedPlanDigest) {
      preview.readiness = await checkExecutionReadiness(tx, {
        steps,
        inputValues: resolvedInputs,
        agentId: resolvedTargetAgentId,
        agentPoolId: resolvedTargetAgentPoolId,
      });
      if (!previewOnly && preview.readiness.some(check => check.state === 'blocked')) {
        throw new RunbookDefinitionError(
          'EXECUTION_NOT_READY: target capability, availability or secret access changed. Preview again before executing.'
        );
      }
    }
    if (previewOnly) {
      if (input.triggeredByUserId) {
        const token = crypto.randomBytes(32).toString('hex');
        const grant = await tx.runbookPreviewAuthorization.create({
          data: {
            ...authorizationScope,
            actorId: input.triggeredByUserId,
            id: crypto.createHash('sha256').update(token).digest('hex'),
            planDigest: preview.digest,
            expiresAt: new Date(Date.now() + 5 * 60_000),
          },
        });
        preview.authorizationToken = token;
        preview.expiresAt = grant.expiresAt.toISOString();
        await logAudit(
          {
            action: 'runbook.execution.previewed',
            ...(auditContext ? { source: 'API' as const } : {}),
            entityType: 'RUNBOOK',
            entityId: runbook.id,
            actorId: input.triggeredByUserId,
            details: {
              ...authorizationScope,
              previewGrantId: grant.id,
              ...(auditContext ? { apiClientId: auditContext.apiClientId } : {}),
              planDigest: preview.digest,
              expiresAt: grant.expiresAt.toISOString(),
            },
          },
          tx
        );
      }
      return preview;
    }
    const authorization = input.triggeredByUserId
      ? await tx.runbookPreviewAuthorization.findUnique({
          where: {
            id: crypto
              .createHash('sha256')
              .update(
                z
                  .string()
                  .regex(/^[a-f0-9]{64}$/)
                  .parse(input.previewAuthorizationToken)
              )
              .digest('hex'),
          },
        })
      : null;
    if (
      input.triggeredByUserId &&
      (!authorization ||
        authorization.consumedAt ||
        authorization.expiresAt.getTime() <= Date.now() ||
        authorization.planDigest !== preview.digest ||
        Object.entries(authorizationScope).some(
          ([key, value]) => authorization[key as keyof typeof authorization] !== value
        ))
    ) {
      throw new RunbookDefinitionError(
        'PREVIEW_AUTHORIZATION_INVALID: Preview authorization is invalid, expired, already used or belongs to another responder or incident. Preview again.'
      );
    }
    if (authorization)
      await assertIndependentPreviewReview(tx, authorization, auditContext?.independentPreview);
    // Actor-less (automatic) write steps wait for approval unless an admin authorized
    // unattended writes for exactly this pinned version. NON_IDEMPOTENT always waits.
    const automaticExecution = mode === 'AUTOMATIC' || !input.triggeredByUserId;
    const unattendedWritesAuthorized =
      automaticExecution &&
      hasWriteAction &&
      binding !== null &&
      binding.unattendedWritesAuthorizedAt !== null &&
      bindingAuthorizesUnattendedWrites(
        binding,
        version.id,
        await computeRuleUnattendedScope(tx, binding)
      );
    const pinnedContext = await readVerifiedResponseContext();
    const executionPlan = {
      schemaVersion: 1,
      evaluationSource:
        input.evaluationSource ?? (planSnapshot?.evaluationSource as string | undefined) ?? null,
      trigger: binding
        ? {
            bindingId: binding.id,
            configRevision: planSnapshot?.configRevision ?? binding.configurationRevision,
            triggerId: input.triggerId ?? suggestion?.triggerId ?? null,
            triggerFingerprint: input.triggerFingerprint ?? suggestion?.fingerprint ?? null,
            suggestionId: suggestion?.id ?? null,
          }
        : null,
      match: { reason: matchReason ?? planSnapshot?.matchReason ?? null },
      runbook: {
        runbookId: runbook.id,
        versionId: version.id,
        version: version.version,
        definitionChecksum: version.checksum,
      },
      automation: pinnedContext
        ? {
            versionId: pinnedContext.versionId,
            versionNumber: pinnedContext.versionNumber,
            contextChecksum: pinnedContext.checksum,
          }
        : null,
      inputs: { values: resolvedInputs, provenance: inputProvenance },
      target: {
        agentId: resolvedTargetAgentId,
        agentPoolId: resolvedTargetAgentPoolId,
        provenance: targetProvenance,
      },
      unattendedWritesAuthorized,
    };
    const execution = await tx.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        serviceId: resolvedServiceId,
        incidentId: input.incidentId,
        bindingId: input.bindingId,
        triggerFingerprint: input.triggerFingerprint ?? suggestion?.fingerprint,
        triggerId: input.triggerId ?? suggestion?.triggerId,
        triggerRevision: evaluatedTriggerRevision ?? suggestion?.triggerRevision,
        triggeredByType: input.triggeredByUserId ? 'USER' : 'TRIGGER',
        triggeredByUserId: input.triggeredByUserId,
        unattendedWritesAuthorized,
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
          provenance: asJson(targetProvenance),
        },
        // Immutable, checksum-verified snapshot of the incident's automation context (or NULL).
        ...(pinnedContext ? { responseContext: asJson(pinnedContext) } : {}),
        executionPlan: asJson(executionPlan),
        steps: {
          create: steps.map(step => ({
            stepKey: step.key,
            sequence: step.sequence,
            name: redactRunbookDisplayName(step.name, resolvedInputs, version.inputs),
            type: step.type,
            containerRuntime:
              step.type === 'DOCKER' &&
              (resolveInputTemplates(step.config, resolvedInputs) as Record<string, unknown>)
                .runtime === 'podman'
                ? 'podman'
                : 'docker',
            riskClass: step.riskClass,
            config: asJson(step.config),
            requiresApproval:
              stepRequiresApproval(step) ||
              (automaticExecution && step.riskClass !== 'READ_ONLY' && !unattendedWritesAuthorized),
            timeoutSeconds: step.timeoutSeconds ?? DEFAULT_STEP_TIMEOUT_SECONDS,
            maxRetries: step.maxRetries ?? definition.defaultMaxRetries ?? 0,
          })),
        },
      },
    });
    if (authorization) {
      const consumed = await tx.runbookPreviewAuthorization.updateMany({
        where: { id: authorization.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date(), executionId: execution.id },
      });
      if (consumed.count !== 1)
        throw new RunbookDefinitionError(
          'PREVIEW_AUTHORIZATION_INVALID: Preview expired or was already used. Preview again.'
        );
    }
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
        ...(auditContext ? { source: 'API' as const } : {}),
        entityType: 'RUNBOOK_EXECUTION',
        entityId: execution.id,
        actorId: input.triggeredByUserId,
        details: {
          ...(auditContext ? { apiClientId: auditContext.apiClientId } : {}),
          runbookId: runbook.id,
          versionId: version.id,
          previewGrant: authorization
            ? {
                id: authorization.id,
                planDigest: authorization.planDigest,
                actorId: authorization.actorId,
                bindingId: authorization.bindingId,
                suggestionId: authorization.suggestionId,
                issuedAt: authorization.createdAt.toISOString(),
                expiresAt: authorization.expiresAt.toISOString(),
              }
            : null,
          incidentId: input.incidentId ?? null,
          serviceId: resolvedServiceId ?? null,
        },
      },
      tx
    );
    return execution;
  };

  if (externalTx) {
    return runner(externalTx);
  }
  return prisma.$transaction(runner);
}

export function resolvedPlanDigest(
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

export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number
): Promise<string> {
  if (!response.body) return '';
  if (typeof response.body.getReader !== 'function') {
    throw new Error(
      'Streaming response reader is unavailable; response body cannot be safely bounded without stream consumption.'
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        await reader.cancel('HTTP response preview limit reached');
        break;
      }
      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) {
        await reader.cancel('HTTP response preview limit reached');
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(combined);
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
        ['GET', 'HEAD'].includes(method) || config.body === undefined
          ? undefined
          : typeof config.body === 'string'
            ? config.body
            : JSON.stringify(config.body),
      signal: controller.signal,
      redirect: 'error',
    });
    const body = await readBoundedResponseBody(response, MAX_OUTPUT_PREVIEW_BYTES);
    const expectedStatus = config.expectedStatus;
    if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 512)}`);
    }
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
      const transitioned = await tx.runbookExecution.updateMany({
        where: { id: executionId, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'WAITING_APPROVAL' },
      });
      if (transitioned.count === 1) {
        const execution = await tx.runbookExecution.findUnique({
          where: { id: executionId },
          select: { incidentId: true },
        });
        if (execution?.incidentId) {
          await addIncidentRunbookEvent(
            tx,
            execution.incidentId,
            'RUNBOOK_APPROVAL_REQUIRED',
            `Runbook approval required: ${redactRunbookDisplayName(step.name)}`
          );
        }
      }
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
        runbookVersion: {
          select: {
            inputs: {
              select: {
                key: true,
                type: true,
              },
            },
          },
        },
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
    const config = workflowConditionSchema.parse(
      resolveInputTemplates(step.config, execution.inputValues as Record<string, unknown>)
    );
    const inputTypeMap = new Map<string, string>(
      execution.runbookVersion?.inputs?.map(input => [input.key, input.type]) ?? []
    );
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
      },
      inputTypeMap
    );
    await prisma.$transaction(async tx => {
      const executionState = await tx.runbookExecution.findUnique({
        where: { id: executionId },
        select: { status: true },
      });
      if (
        !executionState ||
        ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'CANCEL_REQUESTED'].includes(
          executionState.status
        )
      ) {
        return;
      }
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
      const transitioned = await tx.runbookExecution.updateMany({
        where: {
          id: executionId,
          status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
        },
        data: { status: 'RUNNING' },
      });
      if (transitioned.count !== 1) {
        throw new RunbookExecutionInvalidTransitionError(
          executionId,
          executionState.status,
          'RUNNING'
        );
      }
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
            referencedStepInputKeys(step.config, step.type).has(key) && isSecretReference(value)
        ),
        targetAgentId: execution.resolvedTargetAgentId,
        targetAgentPoolId: execution.resolvedTargetAgentPoolId,
        claimDeadlineAt: new Date(Date.now() + 300_000),
        idempotencyKey: crypto.randomUUID(),
        planDigest,
      },
    });
    await tx.runbookExecution.updateMany({
      where: {
        id: executionId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      data: { status: 'WAITING_AGENT' },
    });
  });
}

export async function completeStep(
  executionId: string,
  stepId: string,
  status: 'SUCCEEDED' | 'SKIPPED',
  outputPreview: string
) {
  await prisma.$transaction(async tx => {
    const execution = await tx.runbookExecution.findUnique({
      where: { id: executionId },
      select: { status: true },
    });
    if (
      !execution ||
      ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'CANCEL_REQUESTED'].includes(
        execution.status
      )
    ) {
      return;
    }
    const completed = await tx.runbookExecutionStep.updateMany({
      where: { id: stepId, executionId, status: { in: ['READY', 'RUNNING'] } },
      data: {
        status,
        completedAt: new Date(),
        outputPreview: outputPreview.slice(0, MAX_OUTPUT_PREVIEW_BYTES),
      },
    });
    if (completed.count !== 1) return;
    const transitioned = await tx.runbookExecution.updateMany({
      where: {
        id: executionId,
        status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
      },
      data: { status: 'RUNNING' },
    });
    if (transitioned.count !== 1) {
      throw new RunbookExecutionInvalidTransitionError(executionId, execution.status, 'RUNNING');
    }
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
      await tx.runbookExecutionStep.updateMany({
        where: {
          executionId,
          type: 'WAIT',
          status: 'RUNNING',
        },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      await tx.runbookExecutionStep.updateMany({
        where: {
          executionId,
          type: 'HTTP',
          status: 'RUNNING',
          riskClass: 'READ_ONLY',
        },
        data: { status: 'CANCELLED', completedAt: new Date(), errorCode: 'CANCELLED' },
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
          completedAt: new Date(),
          errorCode: 'CANCELLED_WITH_UNKNOWN_OUTCOME',
          outputPreview:
            'Execution cancelled while HTTP write operation was in flight; outcome is unknown.',
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
        data: { status: 'CANCELLED', completedAt: new Date() },
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
            where: { id: executionId, status: 'CANCEL_REQUESTED' },
            data: {
              status: 'FAILED',
              completedAt: new Date(),
              failureCode: 'UNKNOWN_OUTCOME',
              failureMessage:
                'Execution cancelled but one or more write steps had unverified outcomes.',
            },
          });
          if (failed.count === 1) {
            await addIncidentRunbookEvent(
              tx,
              execution.incidentId,
              'RUNBOOK_FAILED',
              'Runbook execution failed due to an unknown step outcome during cancellation.'
            );
            await enqueueVerificationEvidence(tx, executionId);
          }
        } else {
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
            await enqueueVerificationEvidence(tx, executionId);
          }
        }
      }
    });
    return;
  }
  if (execution.deadlineAt <= new Date()) {
    await prisma.$transaction(tx => finalizeExecutionDeadline(tx, executionId));
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
          failureCode:
            failed.status === 'UNKNOWN' ? 'UNKNOWN_OUTCOME' : (failed.errorCode ?? 'STEP_FAILED'),
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
        await enqueueVerificationEvidence(tx, executionId);
      }
    });
    return;
  }
  const current = execution.steps.find(step => !isTerminalStepStatus(step.status));
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
        await enqueueVerificationEvidence(tx, executionId);
      }
    });
    return;
  }
  if (['WAITING_AGENT', 'WAITING_APPROVAL'].includes(current.status)) return;
  if (current.status === 'RUNNING' && current.type !== 'WAIT') return;
  // Resolution cancels automatic work in the same transaction; this catches any other resolve path.
  if (
    current.riskClass !== 'READ_ONLY' &&
    execution.triggeredByType === 'TRIGGER' &&
    execution.incidentId
  ) {
    const incidentId = execution.incidentId;
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { status: true },
    });
    if (incident?.status === 'RESOLVED') {
      await prisma.$transaction(tx =>
        fenceAutomaticRemediation(tx, { incidentId }, 'Stopped: the incident was resolved.')
      );
      return;
    }
  }
  let owned = current;
  if (current.status === 'PENDING') {
    const claimed = await prisma.runbookExecutionStep.updateMany({
      where: { id: current.id, executionId, status: 'PENDING' },
      data: { status: 'READY' },
    });
    if (claimed.count !== 1) return;
    owned = { ...current, status: 'READY' };
  }
  const updatedExecution = await prisma.runbookExecution.updateMany({
    where: {
      id: executionId,
      status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
    },
    data: { status: 'RUNNING', startedAt: execution.startedAt ?? new Date() },
  });
  if (updatedExecution.count !== 1) return;
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

export async function approveExecutionStep(
  input: {
    executionId: string;
    stepId: string;
    planDigest: string;
    actorId: string;
  },
  externalTx?: Prisma.TransactionClient,
  auditContext?: RunbookExecutionAuditContext
) {
  const command = async (tx: Prisma.TransactionClient) => {
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
    const transitioned = await tx.runbookExecution.updateMany({
      where: {
        id: input.executionId,
        status: { in: ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'] },
      },
      data: { status: 'RUNNING' },
    });
    if (transitioned.count !== 1) {
      throw new RunbookExecutionInvalidTransitionError(
        input.executionId,
        'TERMINAL_OR_CANCELLED',
        'RUNNING'
      );
    }
    await enqueueAdvance(tx, input.executionId);
    await addIncidentRunbookEvent(
      tx,
      step.execution.incidentId,
      'RUNBOOK_APPROVED',
      `Runbook step approved: ${redactRunbookDisplayName(step.name)}`
    );
    await logAudit(
      {
        action: 'runbook.execution.step.approved',
        ...(auditContext ? { source: 'API' as const } : {}),
        entityType: 'RUNBOOK_EXECUTION',
        entityId: input.executionId,
        actorId: input.actorId,
        details: {
          stepId: step.id,
          planDigest: expected,
          ...(auditContext ? { apiClientId: auditContext.apiClientId } : {}),
        },
      },
      tx
    );
    return step;
  };
  if (externalTx) return command(externalTx);
  return prisma.$transaction(command);
}

/** Reject only the exact waiting step that was reviewed. Cancellation and both
 * distinct business events share the caller transaction; no Agent assignment is created.
 */
export async function rejectExecutionStep(
  input: {
    executionId: string;
    stepId: string;
    planDigest: string;
    actorId: string;
    reason: string;
  },
  externalTx?: Prisma.TransactionClient,
  auditContext?: RunbookExecutionAuditContext
) {
  const command = async (tx: Prisma.TransactionClient) => {
    const step = await tx.runbookExecutionStep.findFirst({
      where: { id: input.stepId, executionId: input.executionId },
      include: {
        execution: {
          select: {
            definitionChecksum: true,
            inputValues: true,
            resolvedTargetAgentId: true,
            resolvedTargetAgentPoolId: true,
          },
        },
      },
    });
    if (!step) throw new RunbookExecutionNotFoundError(input.executionId);
    if (step.status !== 'WAITING_APPROVAL')
      throw new RunbookExecutionInvalidTransitionError(input.executionId, step.status, 'CANCELLED');
    if (resolvedPlanDigest(step, step.execution) !== input.planDigest)
      throw new RunbookApprovalPlanChangedError(step.id);
    const changed = await tx.runbookExecutionStep.updateMany({
      where: { id: step.id, executionId: input.executionId, status: 'WAITING_APPROVAL' },
      data: { status: 'CANCELLED', completedAt: new Date(), errorCode: 'APPROVAL_REJECTED' },
    });
    if (changed.count !== 1)
      throw new RunbookExecutionInvalidTransitionError(input.executionId, step.status, 'CANCELLED');
    const parent = await tx.runbookExecution.updateMany({
      where: { id: input.executionId, status: { in: ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'] } },
      data: { updatedAt: new Date() },
    });
    if (parent.count !== 1)
      throw new RunbookExecutionInvalidTransitionError(
        input.executionId,
        'TERMINAL_OR_CANCELLED',
        'CANCEL_REQUESTED'
      );
    await cancelExecution(input.executionId, input.actorId, input.reason, tx, auditContext);
    await logAudit(
      {
        action: 'runbook.execution.step.rejected',
        ...(auditContext ? { source: 'API' as const } : {}),
        entityType: 'RUNBOOK_EXECUTION',
        entityId: input.executionId,
        actorId: input.actorId,
        details: {
          stepId: step.id,
          planDigest: input.planDigest,
          reason: input.reason,
          ...(auditContext ? { apiClientId: auditContext.apiClientId } : {}),
        },
      },
      tx
    );
    return { executionId: input.executionId, stepId: step.id, status: 'CANCEL_REQUESTED' };
  };
  return externalTx ? command(externalTx) : prisma.$transaction(command);
}

export async function cancelExecution(
  executionId: string,
  actorId: string,
  reason?: string,
  externalTx?: Prisma.TransactionClient,
  auditContext?: RunbookExecutionAuditContext
) {
  const command = async (tx: Prisma.TransactionClient) => {
    const result = await tx.runbookExecution.updateMany({
      where: {
        id: executionId,
        status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL', 'PAUSED'] },
      },
      data: { status: 'CANCEL_REQUESTED', cancelRequestedAt: new Date(), failureMessage: reason },
    });
    if (result.count !== 1) {
      const existing = await tx.runbookExecution.findUnique({
        where: { id: executionId },
        select: { status: true },
      });
      // Natural idempotence applies across different HTTP retry keys and UI/API callers.
      if (existing?.status === 'CANCEL_REQUESTED') return;
      throw new RunbookExecutionInvalidTransitionError(executionId, 'TERMINAL', 'CANCEL_REQUESTED');
    }
    await enqueueAdvance(tx, executionId);
    await logAudit(
      {
        action: 'runbook.execution.cancel.requested',
        ...(auditContext ? { source: 'API' as const } : {}),
        entityType: 'RUNBOOK_EXECUTION',
        entityId: executionId,
        actorId,
        details: {
          reason: reason ?? null,
          ...(auditContext ? { apiClientId: auditContext.apiClientId } : {}),
        },
      },
      tx
    );
  };
  if (externalTx) return command(externalTx);
  return prisma.$transaction(command);
}

export async function processRunbookJob(raw: unknown): Promise<void> {
  const payload = jobPayloadSchema.parse(raw);
  if (payload.kind === 'ADVANCE_EXECUTION' || payload.kind === 'RECONCILE_EXECUTION') {
    await advanceExecution(payload.executionId);
    return;
  }
  if (payload.kind === 'VERIFIED_RESOLUTION') {
    await processVerifiedResolution(payload.executionId);
    return;
  }
  if (payload.kind === 'FINALIZE_VERIFICATION') {
    await prisma.$transaction(async tx => {
      await finalizeVerificationEvidence(tx, payload.executionId, payload.revision);
      // Recovery is decided from finalized evidence of the current revision only.
      const current = await tx.runbookExecution.findUnique({
        where: { id: payload.executionId },
        select: { verificationRevision: true },
      });
      if (
        current &&
        (payload.revision === undefined || current.verificationRevision === payload.revision)
      )
        await recordRecoveryVerification(tx, payload.executionId);
    });
    return;
  }
  const { evaluateIncidentTriggers } = await import('./triggers');
  await evaluateIncidentTriggers(payload.incidentId, payload.sourceEventId, {
    source: payload.source,
  });
}
