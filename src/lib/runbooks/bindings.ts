import 'server-only';
import { isValidInputValue, parseInputDefault } from './input-values';

import { Prisma, type RunbookInput, type ServiceAutomationRule } from '@prisma/client';
import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
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
import { lockRunbookForUpdate, lockServiceRuleForUpdate } from './locking';
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
import { computeUnattendedWriteScope } from './unattended-scope';
import { fenceAutomaticRemediation } from './remediation-fence';
import {
  requiresAgent,
  type RunbookDefinition,
  type RunbookRiskClass,
  type RunbookStepType,
} from './types';

export function validateBindingInputValues(
  definitions: (Pick<RunbookInput, 'key' | 'type' | 'required'> & { options?: string[] })[],
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
    if (input.type === 'SELECT' && !(input.options ?? []).includes(value as string))
      throw new RunbookDefinitionError(
        `Runbook input "${input.key}" must be one of its configured options.`
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
      where: { id: agentId, ...(enabled ? { status: { not: 'REVOKED' as const } } : {}) },
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
      enabled &&
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

/** Validates `automation.<field>` conditions and rejects automation-only operators elsewhere. */
async function normalizeTriggerConditions<
  T extends { field: string; operator: string; value?: unknown },
>(tx: Prisma.TransactionClient, serviceId: string, input: T[]): Promise<T[]> {
  const conditions = input.map(condition => ({ ...condition }));
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
  return conditions;
}

export async function createServiceBinding(
  serviceId: string,
  raw: CreateServiceRunbookBindingInput,
  actorId: string,
  initialTrigger?: CreateRunbookTriggerInput,
  expectedVersionId?: string
) {
  const input = createServiceRunbookBindingSchema.parse(raw);
  const requestedEnabled = input.enabled;
  if (input.mode === 'AUTOMATIC') input.enabled = false;
  const trigger = initialTrigger ? createRunbookTriggerSchema.parse(initialTrigger) : undefined;
  // Participate in lifecycle serializability: a row lock alone cannot refresh
  // an archive transaction's earlier snapshot of the binding collection.
  return runSerializableTransaction(async tx => {
    await lockRunbookForUpdate(tx, input.runbookId, { action: 'bind' });
    const service = await tx.service.findUnique({ where: { id: serviceId }, select: { id: true } });
    if (!service) throw new RunbookDefinitionError('Service not found.');
    const version = await resolveBindingVersion(
      tx,
      input.runbookId,
      input.versionStrategy,
      input.runbookVersionId
    );
    if (expectedVersionId && expectedVersionId !== version.id)
      throw new RunbookDefinitionError(
        'The published version changed. Reload the rule form and review its inputs.'
      );
    const inputValues = applyRunbookInputDefaults(version.inputs, input.inputValues);
    validateBindingInputValues(
      staticInputDefinitions(version.inputs, input.contextInputMappings ?? []),
      inputValues
    );
    await validateBindingTarget(
      tx,
      version,
      input.enabled || requestedEnabled,
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
    const triggerConditions = trigger
      ? await normalizeTriggerConditions(tx, serviceId, trigger.conditions)
      : [];
    const binding = await tx.serviceAutomationRule.create({
      data: {
        serviceId,
        name: input.name,
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
        ...(trigger
          ? {
              triggers: {
                create: {
                  event: trigger.event,
                  conditionLogic: trigger.conditionLogic,
                  enabled: trigger.enabled,
                  createdById: actorId,
                  conditions: {
                    create: triggerConditions.map(condition => ({
                      field: condition.field,
                      operator: condition.operator,
                      value:
                        condition.value == null
                          ? Prisma.JsonNull
                          : (condition.value as Prisma.InputJsonValue),
                      sequence: condition.sequence,
                    })),
                  },
                },
              },
            }
          : {}),
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
  actorId: string,
  expectedVersionId?: string,
  expectedConfigurationRevision?: number
) {
  const input = updateServiceRunbookBindingSchema.parse(raw);
  return runSerializableTransaction(async tx => {
    await lockServiceRuleForUpdate(tx, serviceId, bindingId);
    const requestedEnabled = input.enabled;
    const current = await tx.serviceAutomationRule.findFirst({
      where: { id: bindingId, serviceId, detachedAt: null },
    });
    if (!current) throw new RunbookDefinitionError('Service runbook binding not found.');
    assertRuleRevision(current.configurationRevision, expectedConfigurationRevision);
    if ((input.mode ?? current.mode) === 'AUTOMATIC') input.enabled = false;
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
    if (expectedVersionId && expectedVersionId !== version.id)
      throw new RunbookDefinitionError(
        'The selected version changed. Reload the form and review its inputs.'
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
      requestedEnabled ?? current.enabled,
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
    const nextTarget = {
      mode: input.mode ?? current.mode,
      versionStrategy: strategy,
      runbookVersionId: nextRunbookVersionId,
    };
    // `current` was read under the rule lock, so its authorization is authoritative.
    const nextScope = computeUnattendedWriteScope(
      {
        ...nextTarget,
        defaultAgentId: agentId ?? null,
        defaultAgentPoolId: agentPoolId ?? null,
        agentSelector: input.agentSelector ?? current.agentSelector,
        inputValues: values,
        contextInputMappings: automationConfig.inputMappings,
        contextTargetMappings: automationConfig.targetMapping,
        runOnMonitoringIncidents:
          input.runOnMonitoringIncidents ?? current.runOnMonitoringIncidents,
        resolveOnVerifiedRecovery:
          input.resolveOnVerifiedRecovery ?? current.resolveOnVerifiedRecovery,
      },
      await loadScopeTriggers(tx, bindingId)
    );
    const revokeReason =
      unattendedWriteInvalidationReason(current, nextTarget) ??
      (current.unattendedWritesAuthorizedAt && current.unattendedWritesScopeHash !== nextScope
        ? 'SCOPE_CHANGED'
        : null);
    const changed = await tx.serviceAutomationRule.updateMany({
      where: { id: bindingId, serviceId, detachedAt: null },
      data: {
        ...input,
        configurationRevision: { increment: 1 },
        runbookVersionId: nextRunbookVersionId,
        inputValues: values as Prisma.InputJsonValue,
        contextInputMappings: automationConfig.inputMappings as Prisma.InputJsonValue,
        contextTargetMappings: automationConfig.targetMapping as Prisma.InputJsonValue,
        ...(revokeReason ? CLEARED_UNATTENDED_WRITE_AUTHORIZATION : {}),
      },
    });
    if (changed.count !== 1) throw new RunbookDefinitionError('Service runbook binding not found.');
    const updated = await tx.serviceAutomationRule.findFirstOrThrow({
      where: { id: bindingId, serviceId, detachedAt: null },
    });
    if (revokeReason) {
      await fenceAutomaticRemediation(
        tx,
        { bindingId, unattendedWritesOnly: true },
        `Stopped: unattended-write authorization was revoked (${revokeReason}).`
      );
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
            previousVersionId: current.unattendedWritesVersionId,
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
          configurationRevision: updated.configurationRevision,
          contextInputMappings: updated.contextInputMappings,
          contextTargetMappings: updated.contextTargetMappings,
        },
      },
      tx
    );
    return updated;
  });
}

function assertRuleRevision(actual: number, expected?: number) {
  if (expected !== undefined && actual !== expected)
    throw new RunbookDefinitionError(
      'This rule changed since you opened it. Reload the page, review the latest configuration, and apply your changes again.'
    );
}

const CLEARED_UNATTENDED_WRITE_AUTHORIZATION = {
  unattendedWritesVersionId: null,
  unattendedWritesAuthorizedById: null,
  unattendedWritesAuthorizedAt: null,
  unattendedWritesScopeHash: null,
} as const;

type UnattendedWriteInvalidationReason =
  'MODE_CHANGED' | 'STRATEGY_CHANGED' | 'VERSION_CHANGED' | 'SCOPE_CHANGED';

async function loadScopeTriggers(tx: Prisma.TransactionClient, ruleId: string) {
  return tx.runbookTrigger.findMany({
    where: { bindingId: ruleId },
    select: {
      event: true,
      conditionLogic: true,
      enabled: true,
      conditions: { select: { field: true, operator: true, value: true, sequence: true } },
    },
  });
}

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

/** Current approved-scope digest of a stored rule, including all of its enabled triggers. */
export async function computeRuleUnattendedScope(
  tx: Prisma.TransactionClient,
  rule: Parameters<typeof computeUnattendedWriteScope>[0] & { id: string }
) {
  return computeUnattendedWriteScope(rule, await loadScopeTriggers(tx, rule.id));
}

/** True only when an AUTOMATIC rule is still exactly what an administrator authorized. */
export function bindingAuthorizesUnattendedWrites(
  binding: Pick<
    ServiceAutomationRule,
    | 'mode'
    | 'versionStrategy'
    | 'runbookVersionId'
    | 'unattendedWritesVersionId'
    | 'unattendedWritesAuthorizedAt'
    | 'unattendedWritesScopeHash'
  >,
  versionId: string,
  currentScopeHash: string
): boolean {
  return (
    binding.mode === 'AUTOMATIC' &&
    binding.versionStrategy === 'PINNED' &&
    binding.unattendedWritesAuthorizedAt !== null &&
    binding.unattendedWritesVersionId === versionId &&
    binding.runbookVersionId === versionId &&
    binding.unattendedWritesScopeHash !== null &&
    binding.unattendedWritesScopeHash === currentScopeHash
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

async function loadLockedRule(tx: Prisma.TransactionClient, serviceId: string, ruleId: string) {
  await lockServiceRuleForUpdate(tx, serviceId, ruleId);
  const rule = await tx.serviceAutomationRule.findFirst({
    where: { id: ruleId, serviceId, detachedAt: null },
  });
  if (!rule) throw new RunbookDefinitionError('Service runbook binding not found.');
  return rule;
}

/** Admin opt-in allowing an AUTOMATIC rule to run idempotent writes of its pinned version without approval. */
export async function authorizeUnattendedWrites(
  serviceId: string,
  bindingId: string,
  raw: AuthorizeUnattendedWritesInput,
  actorId: string
): Promise<ServiceAutomationRule> {
  const input = authorizeUnattendedWritesSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const binding = await loadLockedRule(tx, serviceId, bindingId);
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
    const scopeHash = computeUnattendedWriteScope(binding, await loadScopeTriggers(tx, bindingId));
    const changed = await tx.serviceAutomationRule.updateMany({
      where: {
        id: bindingId,
        serviceId,
        detachedAt: null,
        mode: 'AUTOMATIC',
        versionStrategy: 'PINNED',
        runbookVersionId: version.id,
      },
      data: {
        unattendedWritesVersionId: version.id,
        unattendedWritesAuthorizedById: actorId,
        unattendedWritesAuthorizedAt: authorizedAt,
        unattendedWritesScopeHash: scopeHash,
        configurationRevision: { increment: 1 },
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
    return tx.serviceAutomationRule.findFirstOrThrow({ where: { id: bindingId, serviceId } });
  });
}

export async function revokeUnattendedWrites(
  serviceId: string,
  bindingId: string,
  actorId: string
): Promise<ServiceAutomationRule> {
  return prisma.$transaction(async tx => {
    const binding = await loadLockedRule(tx, serviceId, bindingId);
    if (!binding.unattendedWritesAuthorizedAt && !binding.unattendedWritesVersionId) return binding;
    await tx.serviceAutomationRule.updateMany({
      where: { id: bindingId, serviceId, detachedAt: null },
      data: {
        ...CLEARED_UNATTENDED_WRITE_AUTHORIZATION,
        configurationRevision: { increment: 1 },
      },
    });
    // Emergency stop: revoking authority also stops executions already running under it.
    await fenceAutomaticRemediation(
      tx,
      { bindingId, unattendedWritesOnly: true },
      'Stopped: unattended-write authorization was revoked.'
    );
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
    return tx.serviceAutomationRule.findFirstOrThrow({ where: { id: bindingId, serviceId } });
  });
}

export async function detachServiceBinding(serviceId: string, bindingId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    await lockServiceRuleForUpdate(tx, serviceId, bindingId);
    const binding = await tx.serviceAutomationRule.findFirst({
      where: { id: bindingId, serviceId, detachedAt: null },
    });
    if (!binding) throw new RunbookDefinitionError('Service runbook binding not found.');
    const deleted = await tx.serviceAutomationRule.updateMany({
      where: { id: bindingId, serviceId, detachedAt: null },
      data: { enabled: false, detachedAt: new Date(), configurationRevision: { increment: 1 } },
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
  actorId: string,
  expectedConfigurationRevision?: number
) {
  const input = createRunbookTriggerSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await lockServiceRuleForUpdate(tx, serviceId, bindingId);
    const binding = await tx.serviceAutomationRule.findFirst({
      where: { id: bindingId, serviceId, detachedAt: null },
    });
    if (!binding) throw new RunbookDefinitionError('Service runbook binding not found.');
    assertRuleRevision(binding.configurationRevision, expectedConfigurationRevision);
    const normalized = await normalizeTriggerConditions(tx, serviceId, input.conditions);
    await tx.serviceAutomationRule.update({
      where: { id: binding.id },
      data: {
        ...(binding.mode === 'AUTOMATIC' ? { enabled: false } : {}),
        configurationRevision: { increment: 1 },
      },
    });
    const previous = await tx.runbookTrigger.findFirst({
      where: { bindingId, event: input.event },
      orderBy: { createdAt: 'asc' },
      include: { conditions: { orderBy: { sequence: 'asc' } } },
    });
    const conditions = normalized.map(condition => ({
      field: condition.field,
      operator: condition.operator,
      value: (condition.value ?? null) as Prisma.InputJsonValue,
      sequence: condition.sequence,
    }));
    // Keep suggestion/execution foreign keys intact. Old condition sets remain in the audit.
    const trigger = previous
      ? await tx.runbookTrigger.update({
          where: { id: previous.id },
          data: {
            revision: { increment: 1 },
            conditionLogic: input.conditionLogic,
            enabled: input.enabled,
            conditions: { deleteMany: {}, create: conditions },
          },
          include: { conditions: { orderBy: { sequence: 'asc' } } },
        })
      : await tx.runbookTrigger.create({
          data: {
            bindingId,
            event: input.event,
            conditionLogic: input.conditionLogic,
            enabled: input.enabled,
            createdById: actorId,
            conditions: { create: conditions },
          },
          include: { conditions: { orderBy: { sequence: 'asc' } } },
        });
    if (binding.unattendedWritesAuthorizedAt) {
      const stale =
        binding.unattendedWritesScopeHash !==
        computeUnattendedWriteScope(binding, await loadScopeTriggers(tx, bindingId));
      if (stale) {
        await tx.serviceAutomationRule.update({
          where: { id: bindingId },
          data: CLEARED_UNATTENDED_WRITE_AUTHORIZATION,
        });
        await fenceAutomaticRemediation(
          tx,
          { bindingId, unattendedWritesOnly: true },
          'Stopped: unattended-write authorization was revoked (SCOPE_CHANGED).'
        );
        await logAudit(
          {
            action: 'runbook.binding.unattended_writes.revoked',
            entityType: 'RUNBOOK',
            entityId: binding.runbookId,
            actorId,
            details: {
              serviceId,
              bindingId,
              reason: 'SCOPE_CHANGED',
              previousVersionId: binding.unattendedWritesVersionId,
              automatic: true,
            },
          },
          tx
        );
      }
    }
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
          triggerId: trigger.id,
          revision: trigger.revision,
          before: previous
            ? {
                revision: previous.revision,
                conditionLogic: previous.conditionLogic,
                enabled: previous.enabled,
                conditions: previous.conditions.map(({ field, operator, value, sequence }) => ({
                  field,
                  operator,
                  value,
                  sequence,
                })),
              }
            : null,
          after: {
            revision: trigger.revision,
            conditionLogic: trigger.conditionLogic,
            enabled: trigger.enabled,
            conditions: trigger.conditions.map(({ field, operator, value, sequence }) => ({
              field,
              operator,
              value,
              sequence,
            })),
          },
          conditionCount: trigger.conditions.length,
        },
      },
      tx
    );
    return trigger;
  });
}

export async function pauseServiceRule(serviceId: string, ruleId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    await lockServiceRuleForUpdate(tx, serviceId, ruleId);
    const rule = await tx.serviceAutomationRule.findFirst({
      where: { id: ruleId, serviceId, detachedAt: null },
    });
    if (!rule) throw new RunbookDefinitionError('Service automation rule not found.');
    await tx.serviceAutomationRule.update({
      where: { id: ruleId },
      data: { enabled: false, configurationRevision: { increment: 1 } },
    });
    await logAudit(
      {
        action: 'runbook.rule.paused',
        entityType: 'RUNBOOK',
        entityId: rule.runbookId,
        actorId,
        details: { serviceId, ruleId },
      },
      tx
    );
  });
}
export async function duplicateServiceRule(serviceId: string, ruleId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    await lockServiceRuleForUpdate(tx, serviceId, ruleId);
    const original = await tx.serviceAutomationRule.findFirst({
      where: { id: ruleId, serviceId, detachedAt: null },
      include: { triggers: { include: { conditions: true } } },
    });
    if (!original) throw new RunbookDefinitionError('Service automation rule not found.');
    const duplicate = await tx.serviceAutomationRule.create({
      data: {
        name: `${original.name || 'Automation rule'} (Copy)`.slice(0, 200),
        serviceId,
        runbookId: original.runbookId,
        runbookVersionId: original.runbookVersionId,
        mode: original.mode,
        versionStrategy: original.versionStrategy,
        defaultAgentId: original.defaultAgentId,
        defaultAgentPoolId: original.defaultAgentPoolId,
        agentSelector: original.agentSelector as Prisma.InputJsonValue,
        inputValues: original.inputValues as Prisma.InputJsonValue,
        resolveOnVerifiedRecovery: original.resolveOnVerifiedRecovery,
        runOnMonitoringIncidents: original.runOnMonitoringIncidents,
        contextInputMappings: original.contextInputMappings as Prisma.InputJsonValue,
        contextTargetMappings: original.contextTargetMappings as Prisma.InputJsonValue,
        // Unattended-write authorization is per rule and is never copied.
        enabled: false,
        createdById: actorId,
        triggers: {
          create: original.triggers.map(trigger => ({
            event: trigger.event,
            conditionLogic: trigger.conditionLogic,
            enabled: trigger.enabled,
            createdById: actorId,
            conditions: {
              create: trigger.conditions.map(condition => ({
                field: condition.field,
                operator: condition.operator,
                value:
                  condition.value === null
                    ? Prisma.JsonNull
                    : (condition.value as Prisma.InputJsonValue),
                sequence: condition.sequence,
              })),
            },
          })),
        },
      },
    });
    await logAudit(
      {
        action: 'runbook.rule.duplicated',
        entityType: 'RUNBOOK',
        entityId: original.runbookId,
        actorId,
        details: { serviceId, sourceRuleId: ruleId, ruleId: duplicate.id, enabled: false },
      },
      tx
    );
    return duplicate;
  });
}

/** Activation is separate from configuration, scoped, locked and based on current evidence. */
export async function activateServiceRule(
  serviceId: string,
  ruleId: string,
  actorId: string,
  confirmMatchAll: boolean
) {
  return runSerializableTransaction(async tx => {
    await lockServiceRuleForUpdate(tx, serviceId, ruleId);
    const rule = await tx.serviceAutomationRule.findFirst({
      where: { id: ruleId, serviceId, detachedAt: null },
      include: {
        runbook: { include: { publishedVersion: { include: { inputs: true } } } },
        runbookVersion: { include: { inputs: true } },
        triggers: { include: { conditions: true } },
      },
    });
    if (!rule || rule.mode !== 'AUTOMATIC' || rule.versionStrategy !== 'PINNED')
      throw new RunbookDefinitionError(
        'Activation requires a paused Automatic rule with an exact version pin.'
      );
    if (rule.enabled) throw new RunbookDefinitionError('This rule is already active.');
    const triggers = rule.triggers.filter(
      trigger => trigger.enabled && trigger.event === 'INCIDENT_CREATED'
    );
    if (!triggers.length)
      throw new RunbookDefinitionError('Configure an active incident-created trigger first.');
    if (triggers.some(trigger => trigger.conditions.length === 0) && !confirmMatchAll)
      throw new RunbookDefinitionError(
        'Explicitly confirm that this rule may match every new incident for this service.'
      );
    const selector = Object.entries((rule.agentSelector ?? {}) as Record<string, unknown>);
    if (
      selector.some(([, value]) => String(value).includes('incident.labels.')) ||
      (selector.length && !rule.defaultAgentId)
    )
      throw new RunbookDefinitionError(
        'Automatic rules require a specific Agent or a fixed pool without a label selector. Use Suggested mode for incident-dependent or dynamic targets.'
      );
    const { getBindingReadiness } = await import('./binding-readiness');
    const readiness = await getBindingReadiness({ ...rule, enabled: true }, new Date(), tx);
    const targetLimit = readiness.checks.find(
      check => check.code === 'AUTOMATIC_POLICY_TARGET_LIMIT'
    );
    if (targetLimit) throw new RunbookDefinitionError(targetLimit.message);
    if (
      readiness.state === 'BLOCKED' ||
      readiness.state === 'UNKNOWN' ||
      readiness.checks.some(
        check =>
          check.state === 'deferred' &&
          check.code !== 'APPROVAL_REQUIRED' &&
          !check.code.startsWith('TARGET_CHECK_')
      )
    )
      throw new RunbookDefinitionError(
        'Resolve configuration and target checks before activation.'
      );
    const version = rule.runbookVersion!;
    const needsAgent = flattenSteps(
      parseRunbookDefinition(version.definition, version.inputs)
    ).some(step => requiresAgent(step.type));
    const accepted = readiness.checks.filter(
      check => check.code.startsWith('AGENT_POLICY_') && check.state === 'passed'
    ).length;
    if (needsAgent && (!readiness.eligibleAgents || accepted !== readiness.eligibleAgents))
      throw new RunbookDefinitionError(
        'Request fresh successful local policy checks for every selected Agent before activation.'
      );
    await tx.serviceAutomationRule.update({
      where: { id: rule.id },
      data: { enabled: true, configurationRevision: { increment: 1 } },
    });
    await logAudit(
      {
        action: 'runbook.rule.activated',
        entityType: 'RUNBOOK',
        entityId: rule.runbookId,
        actorId,
        details: { serviceId, ruleId, versionId: version.id, confirmMatchAll },
      },
      tx
    );
    return { saved: true };
  });
}
