import 'server-only';
import { isValidInputValue, parseInputDefault } from './input-values';

import { Prisma, type RunbookInput } from '@prisma/client';
import {
  runRunbookCommand,
  logRunbookCommandAudit,
  type RunbookCommandActor,
  type RunbookCommandClient,
} from './command-context';
import {
  createServiceRunbookBindingSchema,
  updateServiceRunbookBindingSchema,
  type CreateServiceRunbookBindingInput,
  type UpdateServiceRunbookBindingInput,
  createRunbookTriggerSchema,
  type CreateRunbookTriggerInput,
} from './schemas';
import { flattenSteps, parseRunbookDefinition } from './definition';
import { RunbookDefinitionError, RunbookVersionNotFoundError } from './errors';
import { lockRunbookForUpdate, lockServiceRuleForUpdate } from './locking';
import { requiresAgent } from './types';

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
  selector: Record<string, unknown> = {}
) {
  if (agentId && agentPoolId) {
    throw new RunbookDefinitionError('Select either a specific Agent or an Agent pool, not both.');
  }
  const steps = flattenSteps(parseRunbookDefinition(version.definition));
  const needsAgent = steps.some(step => requiresAgent(step.type));
  if (enabled && needsAgent && !agentId && !agentPoolId && !Object.keys(selector).length) {
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
      where: { id: agentPoolId, lifecycle: 'ACTIVE' },
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

export async function createServiceBinding(
  serviceId: string,
  raw: CreateServiceRunbookBindingInput,
  actor: RunbookCommandActor,
  initialTrigger?: CreateRunbookTriggerInput,
  expectedVersionId?: string,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  const input = createServiceRunbookBindingSchema.parse(raw);
  const requestedEnabled = input.enabled;
  if (input.mode === 'AUTOMATIC') input.enabled = false;
  const trigger = initialTrigger ? createRunbookTriggerSchema.parse(initialTrigger) : undefined;
  // Participate in lifecycle serializability: a row lock alone cannot refresh
  // an archive transaction's earlier snapshot of the binding collection.
  return runRunbookCommand(client, async tx => {
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
    validateBindingInputValues(version.inputs, inputValues);
    await validateBindingTarget(
      tx,
      version,
      input.enabled || requestedEnabled,
      input.defaultAgentId,
      input.defaultAgentPoolId,
      input.agentSelector
    );
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
                    create: trigger.conditions.map(condition => ({
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
    await logRunbookCommandAudit(
      actor,
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
        },
      },
      tx
    );
    return tx.serviceAutomationRule.findUniqueOrThrow({ where: { id: binding.id } });
  });
}

export async function updateServiceBinding(
  serviceId: string,
  bindingId: string,
  raw: UpdateServiceRunbookBindingInput,
  actor: RunbookCommandActor,
  expectedVersionId?: string,
  expectedConfigurationRevision?: number,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  const input = updateServiceRunbookBindingSchema.parse(raw);
  return runRunbookCommand(client, async tx => {
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
    validateBindingInputValues(version.inputs, values);
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
      (input.agentSelector ?? current.agentSelector) as Record<string, unknown>
    );
    const changed = await tx.serviceAutomationRule.updateMany({
      where: { id: bindingId, serviceId, detachedAt: null },
      data: {
        ...input,
        configurationRevision: { increment: 1 },
        runbookVersionId: strategy === 'PINNED' ? version.id : null,
        inputValues: values as Prisma.InputJsonValue,
      },
    });
    if (changed.count !== 1) throw new RunbookDefinitionError('Service runbook binding not found.');
    const updated = await tx.serviceAutomationRule.findFirstOrThrow({
      where: { id: bindingId, serviceId, detachedAt: null },
    });
    await logRunbookCommandAudit(
      actor,
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

export async function detachServiceBinding(
  serviceId: string,
  bindingId: string,
  actor: RunbookCommandActor,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  return runRunbookCommand(client, async tx => {
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
    await logRunbookCommandAudit(
      actor,
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
  actor: RunbookCommandActor,
  expectedConfigurationRevision?: number,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  const input = createRunbookTriggerSchema.parse(raw);
  return runRunbookCommand(client, async tx => {
    await lockServiceRuleForUpdate(tx, serviceId, bindingId);
    const binding = await tx.serviceAutomationRule.findFirst({
      where: { id: bindingId, serviceId, detachedAt: null },
    });
    if (!binding) throw new RunbookDefinitionError('Service runbook binding not found.');
    assertRuleRevision(binding.configurationRevision, expectedConfigurationRevision);
    await tx.serviceAutomationRule.update({
      where: { id: binding.id },
      data: {
        ...(binding.mode === 'AUTOMATIC' ? { enabled: false } : {}),
        configurationRevision: { increment: 1 },
      },
    });
    const previous = await tx.runbookTrigger.findFirst({
      where: { bindingId, event: input.event },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      include: { conditions: { orderBy: { sequence: 'asc' } } },
    });
    // PUT replaces the effective event configuration. Preserve historical trigger IDs,
    // but never leave a second enabled condition set behind.
    const retired = await tx.runbookTrigger.findMany({
      where: {
        bindingId,
        event: input.event,
        enabled: true,
        ...(previous ? { id: { not: previous.id } } : {}),
      },
      select: { id: true, enabled: true, revision: true },
    });
    await tx.runbookTrigger.updateMany({
      where: {
        bindingId,
        event: input.event,
        enabled: true,
        ...(previous ? { id: { not: previous.id } } : {}),
      },
      data: { enabled: false },
    });
    const conditions = input.conditions.map(condition => ({
      field: condition.field,
      operator: condition.operator,
      value: (condition.value ?? null) as Prisma.InputJsonValue,
      sequence: condition.sequence,
    }));
    // Keep suggestion/execution foreign keys intact. Old condition sets remain in the audit.
    const savedTrigger = previous
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
    const trigger = await tx.runbookTrigger.findUniqueOrThrow({
      where: { id: savedTrigger.id },
      include: { conditions: { orderBy: { sequence: 'asc' } } },
    });
    await logRunbookCommandAudit(
      actor,
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
          retiredTriggers: retired,
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

export async function pauseServiceRule(
  serviceId: string,
  ruleId: string,
  actor: RunbookCommandActor,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  return runRunbookCommand(client, async tx => {
    await lockServiceRuleForUpdate(tx, serviceId, ruleId);
    const rule = await tx.serviceAutomationRule.findFirst({
      where: { id: ruleId, serviceId, detachedAt: null },
    });
    if (!rule) throw new RunbookDefinitionError('Service automation rule not found.');
    if (!rule.enabled) return;
    await tx.serviceAutomationRule.update({
      where: { id: ruleId },
      data: { enabled: false, configurationRevision: { increment: 1 } },
    });
    await logRunbookCommandAudit(
      actor,
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
export async function duplicateServiceRule(
  serviceId: string,
  ruleId: string,
  actor: RunbookCommandActor,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  return runRunbookCommand(client, async tx => {
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
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.rule.duplicated',
        entityType: 'RUNBOOK',
        entityId: original.runbookId,
        actorId,
        details: { serviceId, sourceRuleId: ruleId, ruleId: duplicate.id, enabled: false },
      },
      tx
    );
    return tx.serviceAutomationRule.findUniqueOrThrow({ where: { id: duplicate.id } });
  });
}

/** Activation is separate from configuration, scoped, locked and based on current evidence. */
export async function activateServiceRule(
  serviceId: string,
  ruleId: string,
  actor: RunbookCommandActor,
  confirmMatchAll: boolean,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  return runRunbookCommand(client, async tx => {
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
    await logRunbookCommandAudit(
      actor,
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
