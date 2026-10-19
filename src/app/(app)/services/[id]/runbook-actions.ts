'use server';

import { revalidatePath } from 'next/cache';
import { z, ZodError } from 'zod';
import { RunbookError } from '@/lib/runbooks/errors';
import type { RunbookInput } from '@prisma/client';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import { assertCanModifyService, assertCapability } from '@/lib/rbac';
import {
  authorizeUnattendedWrites,
  createServiceBinding,
  detachServiceBinding,
  revokeUnattendedWrites,
  updateServiceBinding,
  replaceBindingTrigger,
} from '@/lib/runbooks/bindings';
import {
  createServiceRunbookBindingSchema,
  updateServiceRunbookBindingSchema,
} from '@/lib/runbooks/schemas';
import { getServiceAutomationContextFields } from '@/lib/automation/context-fields';
import {
  coerceContextConditionValue,
  contextFieldKey,
  parseAgentSelector,
} from '@/components/service/runbooks/context-helpers';
import {
  contextInputMappingsSchema,
  contextTargetMappingSchema,
} from '@/lib/runbooks/automation-binding';

const idSchema = z.string().cuid();
const MAX_TRIGGER_CONDITIONS = 20;
const triggerFormSchema = z
  .object({
    event: z.literal('INCIDENT_CREATED'),
    conditionLogic: z.enum(['AND', 'OR']),
    fields: z.array(z.string().max(80)).max(MAX_TRIGGER_CONDITIONS),
    operators: z.array(z.string().max(20)).max(MAX_TRIGGER_CONDITIONS),
    values: z.array(z.string().max(4096)).max(MAX_TRIGGER_CONDITIONS),
  })
  .strict()
  .refine(
    form =>
      form.fields.length === form.operators.length && form.fields.length === form.values.length,
    'Each trigger condition needs a field, operator and value.'
  );
const resolveOnVerifiedRecoverySchema = z
  .enum(['true', 'false'])
  .optional()
  .transform(value => (value === undefined ? undefined : value === 'true'));
const runOnMonitoringIncidentsSchema = resolveOnVerifiedRecoverySchema;

function jsonField<T extends z.ZodTypeAny>(schema: T) {
  return z
    .string()
    .max(50_000)
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Mapping must be valid JSON.' });
        return z.NEVER;
      }
    })
    .pipe(schema.optional());
}
const contextInputMappingsFieldSchema = jsonField(contextInputMappingsSchema);
const contextTargetMappingsFieldSchema = jsonField(contextTargetMappingSchema);

function automationFormFields(formData: FormData) {
  const optionalString = (name: string) => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  return {
    runOnMonitoringIncidents: runOnMonitoringIncidentsSchema.parse(
      optionalString('runOnMonitoringIncidents')
    ),
    contextInputMappings: contextInputMappingsFieldSchema.parse(
      optionalString('contextInputMappings')
    ),
    contextTargetMappings: contextTargetMappingsFieldSchema.parse(
      optionalString('contextTargetMappings')
    ),
  };
}
const unattendedWritesSchema = z
  .object({ serviceId: idSchema, bindingId: idSchema, expectedVersionId: idSchema })
  .strict();

/** User-correctable failures are returned to the form; anything else propagates. */
function actionError(error: unknown): { error: string } {
  if (error instanceof RunbookError) return { error: error.userMessage };
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { error: `${path}${issue?.message ?? 'Invalid input.'}` };
  }
  throw error;
}

function agentSelectorFrom(formData: FormData): Record<string, string> {
  const parsed = parseAgentSelector(String(formData.get('agentSelector') ?? '{}'));
  if (!parsed.ok)
    throw new ZodError([{ code: 'custom', path: ['agentSelector'], message: parsed.error }]);
  return parsed.selector;
}
const conditionOperatorSchema = z.enum([
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'STARTS_WITH',
  'IN',
  'NOT_IN',
  'EXISTS',
  'NOT_EXISTS',
  'IS_MISSING',
  'IS_UNMAPPED',
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

/** Unattended writes are an operational-mode change: same admin capability as publishing automation. */
async function unattendedWritesActor(serviceId: string) {
  const [actor] = await Promise.all([
    assertCanModifyService(serviceId),
    assertCapability(CAPABILITIES.RUNBOOK_READ_ALL),
    assertCapability(
      CAPABILITIES.AUTOMATION_PUBLISH,
      'Only administrators can authorize unattended runbook write steps.'
    ),
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
  try {
    const parsed = createServiceRunbookBindingSchema.parse({
      runbookId,
      runbookVersionId: strategy === 'PINNED' ? publishedVersionId || undefined : undefined,
      enabled: true,
      mode: formData.get('mode') ?? 'MANUAL',
      versionStrategy: strategy,
      inputValues: generatedInputValues(formData, definitions),
      agentSelector: agentSelectorFrom(formData),
      resolveOnVerifiedRecovery: resolveOnVerifiedRecoverySchema.parse(
        formData.get('resolveOnVerifiedRecovery') ?? undefined
      ),
      ...automationFormFields(formData),
      ...executionTarget(formData.get('executionTarget')),
    });
    await createServiceBinding(serviceId, parsed, actor.id);
  } catch (error) {
    return actionError(error);
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
  try {
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
      agentSelector: agentSelectorFrom(formData),
      resolveOnVerifiedRecovery: resolveOnVerifiedRecoverySchema.parse(
        formData.get('resolveOnVerifiedRecovery') ?? undefined
      ),
      ...automationFormFields(formData),
    });
    await updateServiceBinding(serviceId, idSchema.parse(bindingId), parsed, actor.id);
  } catch (error) {
    return actionError(error);
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
  const parsedBindingId = idSchema.parse(bindingId);
  try {
    const form = triggerFormSchema.parse({
      event: formData.get('event') ?? 'INCIDENT_CREATED',
      conditionLogic: formData.get('conditionLogic') ?? 'AND',
      fields: formData.getAll('conditionField').map(String),
      operators: formData.getAll('conditionOperator').map(String),
      values: formData.getAll('conditionValue').map(String),
    });
    const usesContext = form.fields.some(field => contextFieldKey(field) !== null);
    const contextFields = usesContext
      ? (await getServiceAutomationContextFields(serviceId)).fields
      : [];
    const conditions: Array<{
      field: string;
      operator: z.infer<typeof conditionOperatorSchema>;
      value: unknown;
      sequence: number;
    }> = [];
    for (const [index, field] of form.fields.entries()) {
      if (!field || field === 'none') continue;
      const operator = conditionOperatorSchema.parse(form.operators.at(index));
      const rawValue = form.values.at(index) ?? '';
      const sequence = conditions.length;
      const contextKey = contextFieldKey(field);
      if (contextKey) {
        const definition = contextFields.find(candidate => candidate.key === contextKey);
        if (!definition)
          return {
            error: `automation.${contextKey} is not published in this service's automation schema.`,
          };
        const coerced = coerceContextConditionValue(definition, operator, rawValue);
        if ('error' in coerced) return { error: coerced.error };
        conditions.push({ field, operator, value: coerced.value, sequence });
        continue;
      }
      if (operator === 'IS_MISSING' || operator === 'IS_UNMAPPED')
        return { error: `${operator} is only available for automation fields.` };
      const value =
        operator === 'EXISTS' || operator === 'NOT_EXISTS'
          ? null
          : operator === 'IN' || operator === 'NOT_IN'
            ? rawValue
                .split(',')
                .map(item => item.trim())
                .filter(Boolean)
            : rawValue;
      conditions.push({ field, operator, value, sequence });
    }
    await replaceBindingTrigger(
      serviceId,
      parsedBindingId,
      { event: form.event, conditionLogic: form.conditionLogic, enabled: true, conditions },
      actor.id
    );
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/services/${serviceId}`);
}

export async function authorizeUnattendedWritesAction(
  serviceId: string,
  bindingId: string,
  expectedVersionId: string
) {
  const input = unattendedWritesSchema.parse({ serviceId, bindingId, expectedVersionId });
  const actor = await unattendedWritesActor(input.serviceId);
  try {
    await authorizeUnattendedWrites(
      input.serviceId,
      input.bindingId,
      { expectedVersionId: input.expectedVersionId },
      actor.id
    );
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/services/${input.serviceId}`);
}

export async function revokeUnattendedWritesAction(serviceId: string, bindingId: string) {
  const input = unattendedWritesSchema
    .omit({ expectedVersionId: true })
    .parse({ serviceId, bindingId });
  const actor = await unattendedWritesActor(input.serviceId);
  try {
    await revokeUnattendedWrites(input.serviceId, input.bindingId, actor.id);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/services/${input.serviceId}`);
}
