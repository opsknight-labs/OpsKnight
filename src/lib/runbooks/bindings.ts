import 'server-only';

import type { Prisma, RunbookInput } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  createServiceRunbookBindingSchema,
  updateServiceRunbookBindingSchema,
  type CreateServiceRunbookBindingInput,
  type UpdateServiceRunbookBindingInput,
  createRunbookTriggerSchema,
  type CreateRunbookTriggerInput,
} from './schemas';
import { isSecretReference } from './definition';
import { RunbookDefinitionError, RunbookVersionNotFoundError } from './errors';

function isDuration(value: string): boolean {
  return /^\d+(?:ms|s|m|h|d)$/.test(value);
}

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
    const valid =
      input.type === 'STRING' || input.type === 'SELECT'
        ? typeof value === 'string'
        : input.type === 'NUMBER'
          ? typeof value === 'number' && Number.isFinite(value)
          : input.type === 'BOOLEAN'
            ? typeof value === 'boolean'
            : input.type === 'URL'
              ? typeof value === 'string' &&
                (() => {
                  try {
                    const url = new URL(value);
                    return url.protocol === 'http:' || url.protocol === 'https:';
                  } catch {
                    return false;
                  }
                })()
              : input.type === 'DURATION'
                ? typeof value === 'string' && isDuration(value)
                : input.type === 'SECRET_REF'
                  ? isSecretReference(value)
                  : false;
    if (!valid)
      throw new RunbookDefinitionError(
        `Runbook input "${input.key}" is not a valid ${input.type.toLowerCase()}.`
      );
  }
}

async function resolveBindingVersion(
  tx: Prisma.TransactionClient,
  runbookId: string,
  strategy: 'PINNED' | 'LATEST_PUBLISHED',
  requestedVersionId?: string | null
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
    where: { id: versionId, runbookId, state: 'PUBLISHED' },
    include: { inputs: { orderBy: { sequence: 'asc' } } },
  });
  if (!version) throw new RunbookVersionNotFoundError(versionId);
  return version;
}

export async function createServiceBinding(
  serviceId: string,
  raw: CreateServiceRunbookBindingInput,
  actorId: string
) {
  const input = createServiceRunbookBindingSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const service = await tx.service.findUnique({ where: { id: serviceId }, select: { id: true } });
    if (!service) throw new RunbookDefinitionError('Service not found.');
    const version = await resolveBindingVersion(
      tx,
      input.runbookId,
      input.versionStrategy,
      input.runbookVersionId
    );
    validateBindingInputValues(version.inputs, input.inputValues);
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
        inputValues: input.inputValues as Prisma.InputJsonValue,
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
        },
      },
      tx
    );
    return binding;
  });
}

export async function updateServiceBinding(
  bindingId: string,
  raw: UpdateServiceRunbookBindingInput,
  actorId: string
) {
  const input = updateServiceRunbookBindingSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const current = await tx.serviceRunbookBinding.findUnique({ where: { id: bindingId } });
    if (!current) throw new RunbookDefinitionError('Service runbook binding not found.');
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
      requestedVersionId
    );
    const values = input.inputValues ?? (current.inputValues as Record<string, unknown>);
    validateBindingInputValues(version.inputs, values);
    const updated = await tx.serviceRunbookBinding.update({
      where: { id: bindingId },
      data: {
        ...input,
        runbookVersionId: strategy === 'PINNED' ? version.id : null,
        inputValues: values as Prisma.InputJsonValue,
      },
    });
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
        },
      },
      tx
    );
    return updated;
  });
}

export async function detachServiceBinding(bindingId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    const binding = await tx.serviceRunbookBinding.delete({ where: { id: bindingId } });
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
  bindingId: string,
  raw: CreateRunbookTriggerInput,
  actorId: string
) {
  const input = createRunbookTriggerSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const binding = await tx.serviceRunbookBinding.findUnique({ where: { id: bindingId } });
    if (!binding) throw new RunbookDefinitionError('Service runbook binding not found.');
    await tx.runbookTrigger.deleteMany({ where: { bindingId, event: input.event } });
    const trigger = await tx.runbookTrigger.create({
      data: {
        bindingId,
        event: input.event,
        conditionLogic: input.conditionLogic,
        enabled: input.enabled,
        createdById: actorId,
        conditions: {
          create: input.conditions.map(condition => ({
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
