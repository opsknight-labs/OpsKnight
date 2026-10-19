import 'server-only';
import { isValidInputValue, parseInputDefault } from './input-values';

import type { Prisma, RunbookInput, ServiceRunbookBinding } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  createServiceRunbookBindingSchema,
  updateServiceRunbookBindingSchema,
  authorizeUnattendedWritesSchema,
  type AuthorizeUnattendedWritesInput,
  type CreateServiceRunbookBindingInput,
  type UpdateServiceRunbookBindingInput,
  createRunbookTriggerSchema,
  type CreateRunbookTriggerInput,
} from './schemas';
import { computeDefinitionChecksum, flattenSteps, parseRunbookDefinition } from './definition';
import { RunbookDefinitionError, RunbookVersionNotFoundError } from './errors';
import { lockRunbookForUpdate } from './locking';
import {
  canonicalizeContextTargetMapping,
  isAutomationConditionField,
  parseContextInputMappings,
  parseContextTargetMapping,
  validateAutomationCondition,
  validateContextInputMappings,
  type AutomationFieldDefinition,
  type ContextInputMapping,
  type ContextTargetMapping,
} from './automation-binding';
import { getServiceAutomationContextFields } from '@/lib/automation/context-fields';
import { stepRequiresApproval } from './safety';
import {
  requiresAgent,
  type RunbookDefinition,
  type RunbookRiskClass,
  type RunbookStepType,
} from './types';

export function validateBindingInputValues(
  definitions: Pick<RunbookInput, 'key' | 'type' | 'required'>[],
  values: Record<string, unknown>
): void {
  const known = new Set(definitions.map(input => input.key));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) throw new RunbookDefinitionError(`Unknown runbook input: "${key}".`);
  }
  for (const input of definitions) {
    const value = values[input.key];
    if (value === undefined || value === null || value === '') {
      if (input.required)
        throw new RunbookDefinitionError(`Runbook input "${input.key}" is required.`);
      continue;
    }
    const valid = isValidInputValue(input.type, value);
    if (!valid)
      throw new RunbookDefinitionError(
        `Runbook input "${input.key}" is not a valid ${input.type.toLowerCase()}.`
      );
  }
}

export function applyRunbookInputDefaults(
  definitions: Pick<RunbookInput, 'key' | 'type' | 'defaultValue'>[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...values };
  for (const input of definitions) {
    if (
      normalized[input.key] !== undefined ||
      input.defaultValue === null ||
      input.defaultValue === undefined
    ) {
      continue;
    }
    try {
      normalized[input.key] = parseInputDefault(input);
    } catch (error) {
      throw new RunbookDefinitionError(error instanceof Error ? error.message : 'Invalid default.');
    }
  }
  return normalized;
}

async function resolveBindingVersion(
  tx: Prisma.TransactionClient,
  runbookId: string,
  strategy: 'PINNED' | 'LATEST_PUBLISHED',
  requestedVersionId?: string | null,
  allowRetiredPinnedVersion = false
) {
  const runbook = await tx.runbook.findFirst({
    where: { id: runbookId, archivedAt: null },
    select: { id: true, publishedVersionId: true },
  });
  if (!runbook) throw new RunbookDefinitionError('Runbook was not found or is archived.');
  const versionId = strategy === 'PINNED' ? requestedVersionId : runbook.publishedVersionId;
  if (!versionId)
    throw new RunbookDefinitionError('This runbook does not have a published version.');
  const version = await tx.runbookVersion.findFirst({
    where: {
      id: versionId,
      runbookId,
      state:
        strategy === 'PINNED' && allowRetiredPinnedVersion
          ? { in: ['PUBLISHED', 'RETIRED'] }
          : 'PUBLISHED',
    },
    include: { inputs: { orderBy: { sequence: 'asc' } } },
  });
  if (!version) throw new RunbookVersionNotFoundError(versionId);
  return version;
}

async function validateBindingTarget(
  tx: Prisma.TransactionClient,
  version: { definition: Prisma.JsonValue },
  enabled: boolean,
  agentId?: string | null,
  agentPoolId?: string | null,
  selector: Record<string, unknown> = {},
  hasContextTargets = false
) {
  if (agentId && agentPoolId) {
    throw new RunbookDefinitionError('Select either a specific Agent or an Agent pool, not both.');
  }
  if (
    Object.values(selector).some(
      value => typeof value === 'string' && /\$\{\{\s*(?:context|automation)\./.test(value)
    )
  )
    throw new RunbookDefinitionError(
      'Agent selectors cannot read automation context. Use the approved target mapping table instead.'
    );
  const steps = flattenSteps(parseRunbookDefinition(version.definition));
  const needsAgent = steps.some(step => requiresAgent(step.type));
  if (
    enabled &&
    needsAgent &&
    !agentId &&
    !agentPoolId &&
    !Object.keys(selector).length &&
    !hasContextTargets
  ) {
    throw new RunbookDefinitionError(
      'An enabled runbook with Agent-executed steps requires a specific Agent or Agent pool target.'
    );
  }
  if (agentId) {
    const agent = await tx.runbookAgent.findFirst({
      where: { id: agentId, status: { not: 'REVOKED' } },
      select: { id: true },
    });
    if (!agent) throw new RunbookDefinitionError('The selected Runbook Agent is unavailable.');
  }
  if (agentPoolId) {
    const pool = await tx.runbookAgentPool.findUnique({
      where: { id: agentPoolId },
      select: { id: true, mode: true, _count: { select: { members: true } } },
    });
    if (!pool) throw new RunbookDefinitionError('The selected Runbook Agent pool was not found.');
    if (
      pool.mode === 'LOCAL_HOSTS' &&
      !Object.keys(selector).length &&
      pool._count.members > 1 &&
      steps.some(step => requiresAgent(step.type) && step.riskClass !== 'READ_ONLY')
    ) {
      throw new RunbookDefinitionError(
        `Machine-specific write actions require a specific Agent. This LOCAL_HOSTS pool contains ${pool._count.members} Agents.`
      );
    }
  }
}

async function automationFieldsFor(
  tx: Prisma.TransactionClient,
  serviceId: string
): Promise<AutomationFieldDefinition[]> {
  return (await getServiceAutomationContextFields(serviceId, tx)).fields;
}

/** Validates input/target mappings against the version inputs and the published automation schema. */
async function validateAutomationBindingConfig(
  tx: Prisma.TransactionClient,
  serviceId: string,
  inputs: Pick<RunbookInput, 'key' | 'type' | 'required'>[],
  rawInputMappings: unknown,
  rawTargetMapping: unknown
): Promise<{ inputMappings: ContextInputMapping[]; targetMapping: ContextTargetMapping }> {
  const inputMappings = parseContextInputMappings(rawInputMappings);
  const targetMapping = parseContextTargetMapping(rawTargetMapping);
  if (!inputMappings) throw new RunbookDefinitionError('Context input mappings are malformed.');
  if (!targetMapping) throw new RunbookDefinitionError('Approved target mappings are malformed.');
  if (!inputMappings.length && !targetMapping.contextKey)
    return { inputMappings, targetMapping: { contextKey: null, entries: [] } };
  const fields = await automationFieldsFor(tx, serviceId);
  const inputError = validateContextInputMappings(inputMappings, inputs, fields);
  if (inputError) throw new RunbookDefinitionError(inputError);
  const canonical = canonicalizeContextTargetMapping(targetMapping, fields);
  if (!canonical.ok) throw new RunbookDefinitionError(canonical.error);
  const agentIds = canonical.mapping.entries.flatMap(entry => entry.agentId ?? []);
  const poolIds = canonical.mapping.entries.flatMap(entry => entry.agentPoolId ?? []);
  const [agents, pools] = await Promise.all([
    tx.runbookAgent.count({ where: { id: { in: agentIds }, status: { not: 'REVOKED' } } }),
    tx.runbookAgentPool.count({ where: { id: { in: poolIds } } }),
  ]);
  if (agents !== new Set(agentIds).size)
    throw new RunbookDefinitionError('An approved target Agent is unavailable or revoked.');
  if (pools !== new Set(poolIds).size)
    throw new RunbookDefinitionError('An approved target Agent pool was not found.');
  return { inputMappings, targetMapping: canonical.mapping };
}

/** Required inputs supplied from automation context need no static binding value. */
function staticInputDefinitions<T extends { key: string; required: boolean }>(
  definitions: T[],
  rawMappings: unknown
): T[] {
  const mapped = new Set((parseContextInputMappings(rawMappings) ?? []).map(m => m.inputKey));
  return definitions.map(input => (mapped.has(input.key) ? { ...input, required: false } : input));
}

export async function createServiceBinding(
  serviceId: string,
  raw: CreateServiceRunbookBindingInput,
  actorId: string
) {
  const input = createServiceRunbookBindingSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await lockRunbookForUpdate(tx, input.runbookId, { action: 'bind' });
    const service = await tx.service.findUnique({ where: { id: serviceId }, select: { id: true } });
    if (!service) throw new RunbookDefinitionError('Service not found.');
    const version = await resolveBindingVersion(
      tx,
      input.runbookId,
      input.versionStrategy,
      input.runbookVersionId
    );
    const inputValues = applyRunbookInputDefaults(version.inputs, input.inputValues);
    validateBindingInputValues(
      staticInputDefinitions(version.inputs, input.contextInputMappings ?? []),
      inputValues
    );
    await validateBindingTarget(
      tx,
      version,
      input.enabled,
      input.defaultAgentId,
      input.defaultAgentPoolId,
      input.agentSelector,
      Boolean(parseContextTargetMapping(input.contextTargetMappings ?? {})?.entries.length)
    );
    const automationConfig = await validateAutomationBindingConfig(
      tx,
      serviceId,
      version.inputs,
      input.contextInputMappings ?? [],
      input.contextTargetMappings ?? {}
    );
    const binding = await tx.serviceRunbookBinding.create({
      data: {
        serviceId,
        runbookId: input.runbookId,
        runbookVersionId: input.versionStrategy === 'PINNED' ? version.id : null,
        enabled: input.enabled,
        mode: input.mode,
        versionStrategy: input.versionStrategy,
        defaultAgentPoolId: input.defaultAgentPoolId,
        defaultAgentId: input.defaultAgentId,
        agentSelector: input.agentSelector,
        inputValues: inputValues as Prisma.InputJsonValue,
        resolveOnVerifiedRecovery: input.resolveOnVerifiedRecovery ?? false,
        runOnMonitoringIncidents: input.runOnMonitoringIncidents ?? false,
        contextInputMappings: automationConfig.inputMappings as Prisma.InputJsonValue,
        contextTargetMappings: automationConfig.targetMapping as Prisma.InputJsonValue,
        createdById: actorId,
      },
    });
    await logAudit(
      {
        action: 'runbook.service.attached',
        entityType: 'RUNBOOK',
        entityId: input.runbookId,
        actorId,
        details: {
          serviceId,
          bindingId: binding.id,
          mode: binding.mode,
          versionStrategy: binding.versionStrategy,
          resolveOnVerifiedRecovery: binding.resolveOnVerifiedRecovery,
          runOnMonitoringIncidents: binding.runOnMonitoringIncidents,
        },
      },
      tx
    );
    return binding;
  });
}

export async function updateServiceBinding(
  serviceId: string,
  bindingId: string,
  raw: UpdateServiceRunbookBindingInput,
  actorId: string
) {
  const input = updateServiceRunbookBindingSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const current = await tx.serviceRunbookBinding.findFirst({
      where: { id: bindingId, serviceId },
    });
    if (!current) throw new RunbookDefinitionError('Service runbook binding not found.');
    await lockRunbookForUpdate(tx, current.runbookId, { action: 'update binding for' });
    const strategy = input.versionStrategy ?? current.versionStrategy;
    const requestedVersionId =
      input.runbookVersionId === undefined ? current.runbookVersionId : input.runbookVersionId;
    if (strategy === 'PINNED' && !requestedVersionId)
      throw new RunbookDefinitionError('Pinned bindings require a published version.');
    if ((input.mode ?? current.mode) === 'AUTOMATIC' && strategy !== 'PINNED')
      throw new RunbookDefinitionError(
        'Automatic runbooks must pin an immutable published version.'
      );
    const version = await resolveBindingVersion(
      tx,
      current.runbookId,
      strategy,
      requestedVersionId,
      current.versionStrategy === 'PINNED' &&
        strategy === 'PINNED' &&
        requestedVersionId === current.runbookVersionId
    );
    const values = applyRunbookInputDefaults(
      version.inputs,
      input.inputValues ?? (current.inputValues as Record<string, unknown>)
    );
    validateBindingInputValues(
      staticInputDefinitions(
        version.inputs,
        input.contextInputMappings ?? current.contextInputMappings
      ),
      values
    );
    const agentId =
      input.defaultAgentId === undefined ? current.defaultAgentId : input.defaultAgentId;
    const agentPoolId =
      input.defaultAgentPoolId === undefined
        ? current.defaultAgentPoolId
        : input.defaultAgentPoolId;
    await validateBindingTarget(
      tx,
      version,
      input.enabled ?? current.enabled,
      agentId,
      agentPoolId,
      (input.agentSelector ?? current.agentSelector) as Record<string, unknown>,
      Boolean(
        parseContextTargetMapping(input.contextTargetMappings ?? current.contextTargetMappings)
          ?.entries.length
      )
    );
    const automationConfig = await validateAutomationBindingConfig(
      tx,
      serviceId,
      version.inputs,
      input.contextInputMappings ?? current.contextInputMappings,
      input.contextTargetMappings ?? current.contextTargetMappings
    );
    const nextRunbookVersionId = strategy === 'PINNED' ? version.id : null;
    // Re-read under the runbook lock: authorization may have been granted after `current` was read.
    const authorization = await tx.serviceRunbookBinding.findFirstOrThrow({
      where: { id: bindingId, serviceId },
      select: { unattendedWritesVersionId: true, unattendedWritesAuthorizedAt: true },
    });
    const revokeReason = unattendedWriteInvalidationReason(authorization, {
      mode: input.mode ?? current.mode,
      versionStrategy: strategy,
      runbookVersionId: nextRunbookVersionId,
    });
    const changed = await tx.serviceRunbookBinding.updateMany({
      where: { id: bindingId, serviceId },
      data: {
        ...input,
        runbookVersionId: nextRunbookVersionId,
        inputValues: values as Prisma.InputJsonValue,
        contextInputMappings: automationConfig.inputMappings as Prisma.InputJsonValue,
        contextTargetMappings: automationConfig.targetMapping as Prisma.InputJsonValue,
        configRevision: { increment: 1 },
        ...(revokeReason ? CLEARED_UNATTENDED_WRITE_AUTHORIZATION : {}),
      },
    });
    if (changed.count !== 1) throw new RunbookDefinitionError('Service runbook binding not found.');
    const updated = await tx.serviceRunbookBinding.findFirstOrThrow({
      where: { id: bindingId, serviceId },
    });
    if (revokeReason) {
      await logAudit(
        {
          action: 'runbook.binding.unattended_writes.revoked',
          entityType: 'RUNBOOK',
          entityId: current.runbookId,
          actorId,
          details: {
            serviceId: current.serviceId,
            bindingId,
            reason: revokeReason,
            previousVersionId: authorization.unattendedWritesVersionId,
            automatic: true,
          },
        },
        tx
      );
    }
    await logAudit(
      {
        action: 'runbook.service.binding.updated',
        entityType: 'RUNBOOK',
        entityId: current.runbookId,
        actorId,
        details: {
          serviceId: current.serviceId,
          bindingId,
          mode: updated.mode,
          enabled: updated.enabled,
          resolveOnVerifiedRecovery: updated.resolveOnVerifiedRecovery,
          runOnMonitoringIncidents: updated.runOnMonitoringIncidents,
          configRevision: updated.configRevision,
          contextInputMappings: updated.contextInputMappings,
          contextTargetMappings: updated.contextTargetMappings,
        },
      },
      tx
    );
    return updated;
  });
}

const CLEARED_UNATTENDED_WRITE_AUTHORIZATION = {
  unattendedWritesVersionId: null,
  unattendedWritesAuthorizedById: null,
  unattendedWritesAuthorizedAt: null,
} as const;

type UnattendedWriteInvalidationReason = 'MODE_CHANGED' | 'STRATEGY_CHANGED' | 'VERSION_CHANGED';

function unattendedWriteInvalidationReason(
  authorization: {
    unattendedWritesVersionId: string | null;
    unattendedWritesAuthorizedAt: Date | null;
  },
  next: { mode: string; versionStrategy: string; runbookVersionId: string | null }
): UnattendedWriteInvalidationReason | null {
  if (!authorization.unattendedWritesVersionId && !authorization.unattendedWritesAuthorizedAt)
    return null;
  if (next.mode !== 'AUTOMATIC') return 'MODE_CHANGED';
  if (next.versionStrategy !== 'PINNED') return 'STRATEGY_CHANGED';
  if (
    !authorization.unattendedWritesAuthorizedAt ||
    next.runbookVersionId !== authorization.unattendedWritesVersionId
  )
    return 'VERSION_CHANGED';
  return null;
}

/** True only when an AUTOMATIC binding carries an authorization for the exact pinned version. */
export function bindingAuthorizesUnattendedWrites(
  binding: Pick<
    ServiceRunbookBinding,
    | 'mode'
    | 'versionStrategy'
    | 'runbookVersionId'
    | 'unattendedWritesVersionId'
    | 'unattendedWritesAuthorizedAt'
  >,
  versionId: string
): boolean {
  return (
    binding.mode === 'AUTOMATIC' &&
    binding.versionStrategy === 'PINNED' &&
    binding.unattendedWritesAuthorizedAt !== null &&
    binding.unattendedWritesVersionId === versionId &&
    binding.runbookVersionId === versionId
  );
}

export interface UnattendedWriteAction {
  key: string;
  name: string;
  type: RunbookStepType;
  riskClass: RunbookRiskClass;
  hasVerification: boolean;
  /** NON_IDEMPOTENT or explicitly approval-gated actions wait for a responder even when authorized. */
  alwaysRequiresApproval: boolean;
}

export interface UnattendedWriteEligibility {
  writeActions: UnattendedWriteAction[];
  eligible: boolean;
  reasons: string[];
}

/**
 * Pure review of a version for unattended-write authorization. Every write action must
 * author at least one verification step so recovery can be proven, not assumed.
 */
export function summarizeUnattendedWriteEligibility(
  definition: RunbookDefinition | Prisma.JsonValue,
  inputs?: ReadonlyArray<{ key: string; type?: string }>
): UnattendedWriteEligibility {
  let parsed: RunbookDefinition;
  try {
    parsed = parseRunbookDefinition(definition, inputs);
  } catch (error) {
    return {
      writeActions: [],
      eligible: false,
      reasons: [
        `RUNBOOK_DEFINITION_INVALID: ${error instanceof Error ? error.message : 'Definition is invalid.'}`,
      ],
    };
  }
  const writeActions = flattenSteps(parsed)
    .filter(step => step.riskClass !== 'READ_ONLY')
    .map(step => ({
      key: step.key,
      name: step.name,
      type: step.type,
      riskClass: step.riskClass,
      hasVerification: (step.verification?.steps.length ?? 0) > 0,
      alwaysRequiresApproval: stepRequiresApproval(step),
    }));
  const reasons: string[] = [];
  if (!writeActions.length)
    reasons.push(
      'UNATTENDED_WRITE_NOT_APPLICABLE: This version has no write actions; it already runs without approval.'
    );
  for (const action of writeActions) {
    if (!action.hasVerification)
      reasons.push(
        `UNATTENDED_WRITE_VERIFICATION_REQUIRED: Write action "${action.name}" (${action.key}) has no verification step.`
      );
  }
  return { writeActions, eligible: reasons.length === 0, reasons };
}

async function loadLockedBinding(
  tx: Prisma.TransactionClient,
  serviceId: string,
  bindingId: string,
  action: string
) {
  const found = await tx.serviceRunbookBinding.findFirst({
    where: { id: bindingId, serviceId },
    select: { runbookId: true },
  });
  if (!found) throw new RunbookDefinitionError('Service runbook binding not found.');
  await lockRunbookForUpdate(tx, found.runbookId, { action });
  const binding = await tx.serviceRunbookBinding.findFirst({ where: { id: bindingId, serviceId } });
  if (!binding) throw new RunbookDefinitionError('Service runbook binding not found.');
  return binding;
}

/** Admin opt-in allowing an AUTOMATIC binding to run idempotent writes of its pinned version without approval. */
export async function authorizeUnattendedWrites(
  serviceId: string,
  bindingId: string,
  raw: AuthorizeUnattendedWritesInput,
  actorId: string
): Promise<ServiceRunbookBinding> {
  const input = authorizeUnattendedWritesSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const binding = await loadLockedBinding(
      tx,
      serviceId,
      bindingId,
      'authorize unattended writes for'
    );
    if (binding.mode !== 'AUTOMATIC' || binding.versionStrategy !== 'PINNED')
      throw new RunbookDefinitionError(
        'UNATTENDED_WRITE_REQUIRES_AUTOMATIC_PINNED: Only an AUTOMATIC binding pinned to a published version can run writes unattended.'
      );
    if (!binding.runbookVersionId || binding.runbookVersionId !== input.expectedVersionId)
      throw new RunbookDefinitionError(
        'UNATTENDED_WRITE_VERSION_CHANGED: The pinned version changed. Review the current version before authorizing.'
      );
    const version = await tx.runbookVersion.findFirst({
      where: { id: binding.runbookVersionId, runbookId: binding.runbookId, state: 'PUBLISHED' },
      include: { inputs: { orderBy: { sequence: 'asc' } } },
    });
    if (!version) throw new RunbookVersionNotFoundError(binding.runbookVersionId);
    const definition = parseRunbookDefinition(version.definition, version.inputs);
    if (computeDefinitionChecksum(definition) !== version.checksum)
      throw new RunbookDefinitionError('Published runbook checksum does not match its definition.');
    const eligibility = summarizeUnattendedWriteEligibility(definition, version.inputs);
    if (!eligibility.eligible) {
      throw new RunbookDefinitionError(
        eligibility.reasons.find(reason =>
          reason.startsWith('UNATTENDED_WRITE_VERIFICATION_REQUIRED')
        ) ?? eligibility.reasons[0],
        { reasons: eligibility.reasons }
      );
    }
    const authorizedAt = new Date();
    const changed = await tx.serviceRunbookBinding.updateMany({
      where: {
        id: bindingId,
        serviceId,
        mode: 'AUTOMATIC',
        versionStrategy: 'PINNED',
        runbookVersionId: version.id,
      },
      data: {
        unattendedWritesVersionId: version.id,
        unattendedWritesAuthorizedById: actorId,
        unattendedWritesAuthorizedAt: authorizedAt,
        configRevision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new RunbookDefinitionError('Service runbook binding not found.');
    await logAudit(
      {
        action: 'runbook.binding.unattended_writes.authorized',
        entityType: 'RUNBOOK',
        entityId: binding.runbookId,
        actorId,
        details: {
          serviceId,
          bindingId,
          versionId: version.id,
          version: version.version,
          checksum: version.checksum,
          writeActions: eligibility.writeActions.map(action => action.key),
          alwaysApproval: eligibility.writeActions
            .filter(action => action.alwaysRequiresApproval)
            .map(action => action.key),
        },
      },
      tx
    );
    return tx.serviceRunbookBinding.findFirstOrThrow({ where: { id: bindingId, serviceId } });
  });
}

export async function revokeUnattendedWrites(
  serviceId: string,
  bindingId: string,
  actorId: string
): Promise<ServiceRunbookBinding> {
  return prisma.$transaction(async tx => {
    const binding = await loadLockedBinding(
      tx,
      serviceId,
      bindingId,
      'revoke unattended writes for'
    );
    if (!binding.unattendedWritesAuthorizedAt && !binding.unattendedWritesVersionId) return binding;
    await tx.serviceRunbookBinding.updateMany({
      where: { id: bindingId, serviceId },
      data: { ...CLEARED_UNATTENDED_WRITE_AUTHORIZATION, configRevision: { increment: 1 } },
    });
    await logAudit(
      {
        action: 'runbook.binding.unattended_writes.revoked',
        entityType: 'RUNBOOK',
        entityId: binding.runbookId,
        actorId,
        details: {
          serviceId,
          bindingId,
          reason: 'REVOKED',
          previousVersionId: binding.unattendedWritesVersionId,
          automatic: false,
        },
      },
      tx
    );
    return tx.serviceRunbookBinding.findFirstOrThrow({ where: { id: bindingId, serviceId } });
  });
}

export async function detachServiceBinding(serviceId: string, bindingId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    const binding = await tx.serviceRunbookBinding.findFirst({
      where: { id: bindingId, serviceId },
    });
    if (!binding) throw new RunbookDefinitionError('Service runbook binding not found.');
    const deleted = await tx.serviceRunbookBinding.deleteMany({
      where: { id: bindingId, serviceId },
    });
    if (deleted.count !== 1) throw new RunbookDefinitionError('Service runbook binding not found.');
    await logAudit(
      {
        action: 'runbook.service.detached',
        entityType: 'RUNBOOK',
        entityId: binding.runbookId,
        actorId,
        details: { serviceId: binding.serviceId, bindingId },
      },
      tx
    );
    return binding;
  });
}

export async function replaceBindingTrigger(
  serviceId: string,
  bindingId: string,
  raw: CreateRunbookTriggerInput,
  actorId: string
) {
  const input = createRunbookTriggerSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const binding = await tx.serviceRunbookBinding.findFirst({
      where: { id: bindingId, serviceId },
    });
    if (!binding) throw new RunbookDefinitionError('Service runbook binding not found.');
    await lockRunbookForUpdate(tx, binding.runbookId, { action: 'configure triggers for' });
    const conditions = input.conditions.map(condition => ({ ...condition }));
    if (conditions.some(condition => isAutomationConditionField(condition.field))) {
      const fields = await automationFieldsFor(tx, serviceId);
      for (const condition of conditions) {
        if (!isAutomationConditionField(condition.field)) continue;
        const validated = validateAutomationCondition(condition, fields);
        if (!validated.ok) throw new RunbookDefinitionError(validated.error);
        condition.value = validated.value;
      }
    }
    const misplaced = conditions.find(
      condition =>
        !isAutomationConditionField(condition.field) &&
        (condition.operator === 'IS_MISSING' || condition.operator === 'IS_UNMAPPED')
    );
    if (misplaced)
      throw new RunbookDefinitionError(
        `${misplaced.operator} is only available for automation.<field> conditions.`
      );
    await tx.serviceRunbookBinding.update({
      where: { id: bindingId },
      data: { configRevision: { increment: 1 } },
    });
    await tx.runbookTrigger.deleteMany({ where: { bindingId, event: input.event } });
    const trigger = await tx.runbookTrigger.create({
      data: {
        bindingId,
        event: input.event,
        conditionLogic: input.conditionLogic,
        enabled: input.enabled,
        createdById: actorId,
        conditions: {
          create: conditions.map(condition => ({
            field: condition.field,
            operator: condition.operator,
            value: (condition.value ?? null) as Prisma.InputJsonValue,
            sequence: condition.sequence,
          })),
        },
      },
      include: { conditions: { orderBy: { sequence: 'asc' } } },
    });
    await logAudit(
      {
        action: 'runbook.trigger.configured',
        entityType: 'RUNBOOK',
        entityId: binding.runbookId,
        actorId,
        details: {
          bindingId,
          serviceId: binding.serviceId,
          event: trigger.event,
          conditionCount: trigger.conditions.length,
        },
      },
      tx
    );
    return trigger;
  });
}
