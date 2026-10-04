'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { RunbookError } from '@/lib/runbooks/errors';
import type { RunbookInput } from '@prisma/client';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import { assertCanModifyService, assertCapability } from '@/lib/rbac';
import {
  createServiceBinding,
  detachServiceBinding,
  updateServiceBinding,
  replaceBindingTrigger,
} from '@/lib/runbooks/bindings';
import {
  createServiceRunbookBindingSchema,
  updateServiceRunbookBindingSchema,
} from '@/lib/runbooks/schemas';

const idSchema = z.string().cuid();
const conditionOperatorSchema = z.enum([
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'STARTS_WITH',
  'IN',
  'NOT_IN',
  'EXISTS',
  'NOT_EXISTS',
]);

function generatedInputValues(
  formData: FormData,
  definitions: Pick<RunbookInput, 'key' | 'type'>[]
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const input of definitions) {
    const raw = formData.get(`input:${input.key}`);
    if (input.type === 'BOOLEAN') {
      values[input.key] = raw === 'true';
      continue;
    }
    if (typeof raw !== 'string' || raw === '') continue;
    if (input.type === 'NUMBER') {
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new Error(`${input.key} must be a valid number.`);
      values[input.key] = number;
    } else if (input.type === 'SECRET_REF') {
      values[input.key] = raw.startsWith('secret://') ? raw : `secret://${raw}`;
    } else {
      values[input.key] = raw;
    }
  }
  return values;
}

async function inputDefinitions(runbookId: string, versionId?: string | null) {
  if (versionId) {
    const version = await prisma.runbookVersion.findFirst({
      where: { id: versionId, runbookId },
      include: { inputs: { orderBy: { sequence: 'asc' } } },
    });
    if (!version) throw new Error('The selected runbook version was not found.');
    return version.inputs;
  }
  const runbook = await prisma.runbook.findUnique({
    where: { id: runbookId },
    include: { publishedVersion: { include: { inputs: { orderBy: { sequence: 'asc' } } } } },
  });
  if (!runbook?.publishedVersion) throw new Error('This runbook has no published version.');
  return runbook.publishedVersion.inputs;
}

function executionTarget(value: FormDataEntryValue | null) {
  const raw = typeof value === 'string' ? value : '';
  if (!raw || raw === 'none') return { defaultAgentId: undefined, defaultAgentPoolId: undefined };
  const [kind, id] = raw.split(':', 2);
  const targetId = idSchema.parse(id);
  if (kind === 'agent') return { defaultAgentId: targetId, defaultAgentPoolId: undefined };
  if (kind === 'pool') return { defaultAgentId: undefined, defaultAgentPoolId: targetId };
  throw new Error('Invalid Runbook execution target.');
}

async function bindingActor(serviceId: string) {
  const [actor] = await Promise.all([
    assertCanModifyService(serviceId),
    assertCapability(CAPABILITIES.RUNBOOK_READ_ALL),
  ]);
  return actor;
}

export async function attachRunbookAction(serviceId: string, formData: FormData) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const strategy = String(formData.get('versionStrategy') ?? 'LATEST_PUBLISHED');
  const [runbookId, publishedVersionId] = String(formData.get('runbookSelection') ?? '').split(':');
  const definitions = await inputDefinitions(
    idSchema.parse(runbookId),
    strategy === 'PINNED' ? idSchema.parse(publishedVersionId) : undefined
  );
  const parsed = createServiceRunbookBindingSchema.parse({
    runbookId,
    runbookVersionId: strategy === 'PINNED' ? publishedVersionId || undefined : undefined,
    enabled: true,
    mode: formData.get('mode') ?? 'MANUAL',
    versionStrategy: strategy,
    inputValues: generatedInputValues(formData, definitions),
    agentSelector: JSON.parse(String(formData.get('agentSelector') ?? '{}')),
    ...executionTarget(formData.get('executionTarget')),
  });
  try {
    await createServiceBinding(serviceId, parsed, actor.id);
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    throw error;
  }
  revalidatePath(`/services/${serviceId}`);
}

export async function updateRunbookBindingAction(
  serviceId: string,
  bindingId: string,
  formData: FormData
) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const target = executionTarget(formData.get('executionTarget'));
  const binding = await prisma.serviceRunbookBinding.findFirst({
    where: { id: idSchema.parse(bindingId), serviceId },
    select: { runbookId: true },
  });
  if (!binding) throw new Error('Service runbook binding not found.');
  const selectedVersionId =
    formData.get('versionStrategy') === 'PINNED'
      ? idSchema.parse(String(formData.get('runbookVersionId') ?? ''))
      : undefined;
  const definitions = await inputDefinitions(binding.runbookId, selectedVersionId);
  const parsed = updateServiceRunbookBindingSchema.parse({
    enabled: formData.get('enabled') === 'true',
    mode: formData.get('mode'),
    versionStrategy: formData.get('versionStrategy'),
    runbookVersionId:
      formData.get('versionStrategy') === 'PINNED'
        ? formData.get('runbookVersionId') || null
        : null,
    inputValues: generatedInputValues(formData, definitions),
    defaultAgentId: target.defaultAgentId ?? null,
    defaultAgentPoolId: target.defaultAgentPoolId ?? null,
    agentSelector: JSON.parse(String(formData.get('agentSelector') ?? '{}')),
  });
  try {
    await updateServiceBinding(serviceId, idSchema.parse(bindingId), parsed, actor.id);
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    throw error;
  }
  revalidatePath(`/services/${serviceId}`);
}

export async function detachRunbookAction(serviceId: string, bindingId: string) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  await detachServiceBinding(serviceId, idSchema.parse(bindingId), actor.id);
  revalidatePath(`/services/${serviceId}`);
}

export async function configureRunbookTriggerAction(
  serviceId: string,
  bindingId: string,
  formData: FormData
) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const fields = formData.getAll('conditionField').map(String);
  const operators = formData.getAll('conditionOperator').map(String);
  const rawValues = formData.getAll('conditionValue').map(String);
  const conditions = fields.flatMap((field, sequence) => {
    if (!field || field === 'none') return [];
    const operator = conditionOperatorSchema.parse(operators.at(sequence) ?? 'EQUALS');
    const rawValue = rawValues.at(sequence) ?? '';
    const value =
      operator === 'EXISTS' || operator === 'NOT_EXISTS'
        ? null
        : operator === 'IN' || operator === 'NOT_IN'
          ? rawValue
              .split(',')
              .map(item => item.trim())
              .filter(Boolean)
          : rawValue;
    return [{ field, operator, value, sequence }];
  });
  await replaceBindingTrigger(
    serviceId,
    idSchema.parse(bindingId),
    {
      event: String(formData.get('event') ?? 'INCIDENT_CREATED') as 'INCIDENT_CREATED',
      conditionLogic: z.enum(['AND', 'OR']).parse(formData.get('conditionLogic') ?? 'AND'),
      enabled: true,
      conditions,
    },
    actor.id
  );
  revalidatePath(`/services/${serviceId}`);
}
