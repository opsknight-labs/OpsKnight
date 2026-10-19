'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parseAgentSelector } from '@/lib/runbooks/selector-input';
import { RunbookDefinitionError, RunbookError } from '@/lib/runbooks/errors';
import type { RunbookInput } from '@prisma/client';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import { assertCanModifyService, assertCanViewService, assertCapability } from '@/lib/rbac';
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
const optionalBooleanFieldSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform(value => (value === undefined ? undefined : value === 'true'));

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
const automationFormSchema = z.object({
  resolveOnVerifiedRecovery: optionalBooleanFieldSchema,
  runOnMonitoringIncidents: optionalBooleanFieldSchema,
  contextInputMappings: jsonField(contextInputMappingsSchema),
  contextTargetMappings: jsonField(contextTargetMappingSchema),
});

/** Automation options are validated separately so their errors stay specific and field-scoped. */
function automationFormFields(
  formData: FormData
):
  | { data: z.infer<typeof automationFormSchema> }
  | { error: string; field: 'automationConfiguration' } {
  const optionalString = (name: string) => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  const parsed = automationFormSchema.safeParse({
    resolveOnVerifiedRecovery: optionalString('resolveOnVerifiedRecovery'),
    runOnMonitoringIncidents: optionalString('runOnMonitoringIncidents'),
    contextInputMappings: optionalString('contextInputMappings'),
    contextTargetMappings: optionalString('contextTargetMappings'),
  });
  if (parsed.success) return { data: parsed.data };
  const issue = parsed.error.issues[0];
  const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  return {
    error: `${path}${issue?.message ?? 'Invalid automation configuration.'}`,
    field: 'automationConfiguration',
  };
}
const unattendedWritesSchema = z
  .object({ serviceId: idSchema, bindingId: idSchema, expectedVersionId: idSchema })
  .strict();
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
  const known = new Set(definitions.map(input => `input:${input.key}`));
  for (const name of formData.keys())
    if (name.startsWith('input:') && !known.has(name))
      throw new RunbookDefinitionError(
        'Inputs changed. Reload the form and review the selected version.'
      );
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
    assertCapability(CAPABILITIES.RUNBOOK_MANAGE),
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

async function attachRunbook(serviceId: string, formData: FormData) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const selector = parseAgentSelector(formData.get('agentSelector'));
  if (!selector.success) return { error: selector.error, field: 'agentSelector' };
  const automation = automationFormFields(formData);
  if ('error' in automation) return automation;
  const strategy = String(formData.get('versionStrategy') ?? 'LATEST_PUBLISHED');
  const [runbookId] = String(formData.get('runbookSelection') ?? '').split(':');
  const selectedVersionId = idSchema.parse(
    String(formData.get(strategy === 'PINNED' ? 'runbookVersionId' : 'expectedVersionId') ?? '')
  );
  const definitions = await inputDefinitions(idSchema.parse(runbookId), selectedVersionId);
  const parsed = createServiceRunbookBindingSchema.parse({
    runbookId,
    name: String(formData.get('ruleName') ?? ''),
    runbookVersionId: strategy === 'PINNED' ? selectedVersionId : undefined,
    enabled: formData.get('enabled') === 'true',
    mode: formData.get('mode') ?? 'MANUAL',
    versionStrategy: strategy,
    inputValues: generatedInputValues(formData, definitions),
    agentSelector: selector.data,
    ...automation.data,
    ...executionTarget(formData.get('executionTarget')),
  });
  try {
    await createServiceBinding(
      serviceId,
      parsed,
      actor.id,
      formData.get('initialTrigger') === 'INCIDENT_CREATED'
        ? {
            event: 'INCIDENT_CREATED',
            enabled: true,
            conditionLogic: 'AND',
            conditions: [],
          }
        : undefined,
      selectedVersionId
    );
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    throw error;
  }
  revalidatePath(`/services/${serviceId}`);
}

async function updateRunbookBinding(serviceId: string, bindingId: string, formData: FormData) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const selector = parseAgentSelector(formData.get('agentSelector'));
  if (!selector.success) return { error: selector.error, field: 'agentSelector' };
  const automation = automationFormFields(formData);
  if ('error' in automation) return automation;
  const target = executionTarget(formData.get('executionTarget'));
  const binding = await prisma.serviceAutomationRule.findFirst({
    where: { id: idSchema.parse(bindingId), serviceId },
    select: { runbookId: true },
  });
  if (!binding) throw new Error('Service runbook binding not found.');
  const selectedVersionId =
    formData.get('versionStrategy') === 'PINNED'
      ? idSchema.parse(String(formData.get('runbookVersionId') ?? ''))
      : undefined;
  const expectedVersionId = idSchema.parse(
    String(formData.get('expectedVersionId') ?? selectedVersionId ?? '')
  );
  const definitions = await inputDefinitions(
    binding.runbookId,
    selectedVersionId ?? expectedVersionId
  );
  const parsed = updateServiceRunbookBindingSchema.parse({
    name: String(formData.get('ruleName') ?? ''),
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
    agentSelector: selector.data,
    ...automation.data,
  });
  try {
    await updateServiceBinding(
      serviceId,
      idSchema.parse(bindingId),
      parsed,
      actor.id,
      expectedVersionId,
      z.coerce.number().int().positive().parse(formData.get('expectedConfigurationRevision'))
    );
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
  const parsedBindingId = idSchema.parse(bindingId);
  const form = triggerFormSchema.safeParse({
    event: formData.get('event') ?? 'INCIDENT_CREATED',
    conditionLogic: formData.get('conditionLogic') ?? 'AND',
    fields: formData.getAll('conditionField').map(String),
    operators: formData.getAll('conditionOperator').map(String),
    values: formData.getAll('conditionValue').map(String),
  });
  if (!form.success) {
    const issue = form.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { error: `${path}${issue?.message ?? 'Review the trigger conditions.'}` };
  }
  const usesContext = form.data.fields.some(field => contextFieldKey(field) !== null);
  const contextFields = usesContext
    ? (await getServiceAutomationContextFields(serviceId)).fields
    : [];
  const conditions: Array<{
    field: string;
    operator: z.infer<typeof conditionOperatorSchema>;
    value: unknown;
    sequence: number;
  }> = [];
  for (const [index, field] of form.data.fields.entries()) {
    if (!field || field === 'none') continue;
    const operator = conditionOperatorSchema.safeParse(form.data.operators.at(index));
    if (!operator.success) return { error: 'Choose a supported condition operator.' };
    const rawValue = form.data.values.at(index) ?? '';
    const sequence = conditions.length;
    const contextKey = contextFieldKey(field);
    if (contextKey) {
      const definition = contextFields.find(candidate => candidate.key === contextKey);
      if (!definition)
        return {
          error: `automation.${contextKey} is not published in this service's automation schema.`,
        };
      const coerced = coerceContextConditionValue(definition, operator.data, rawValue);
      if ('error' in coerced) return { error: coerced.error };
      conditions.push({ field, operator: operator.data, value: coerced.value, sequence });
      continue;
    }
    if (operator.data === 'IS_MISSING' || operator.data === 'IS_UNMAPPED')
      return { error: `${operator.data} is only available for automation fields.` };
    const value =
      operator.data === 'EXISTS' || operator.data === 'NOT_EXISTS'
        ? null
        : operator.data === 'IN' || operator.data === 'NOT_IN'
          ? rawValue
              .split(',')
              .map(item => item.trim())
              .filter(Boolean)
          : rawValue;
    conditions.push({ field, operator: operator.data, value, sequence });
  }
  try {
    await replaceBindingTrigger(
      serviceId,
      parsedBindingId,
      {
        event: form.data.event,
        conditionLogic: form.data.conditionLogic,
        enabled: true,
        conditions,
      },
      actor.id,
      z.coerce.number().int().positive().parse(formData.get('expectedConfigurationRevision'))
    );
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    throw error;
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
    if (error instanceof RunbookError) return { error: error.userMessage };
    throw error;
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
    if (error instanceof RunbookError) return { error: error.userMessage };
    throw error;
  }
  revalidatePath(`/services/${input.serviceId}`);
}

export async function checkRulePolicyAction(serviceId: string, ruleId: string) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const { requestRulePolicyChecks } = await import('@/lib/runbooks/policy-checks');
  try {
    const result = await requestRulePolicyChecks(serviceId, idSchema.parse(ruleId), actor.id);
    revalidatePath(`/services/${serviceId}`);
    return result;
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    const { logger } = await import('@/lib/logger');
    logger.error('Failed to check rule policy', {
      error,
      serviceId,
      ruleId,
      component: 'runbook-actions',
    });
    return {
      error: 'Could not complete policy check. Please check configuration and try again.',
    };
  }
}

export async function pauseRuleAction(serviceId: string, ruleId: string) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const { pauseServiceRule } = await import('@/lib/runbooks/bindings');
  await pauseServiceRule(serviceId, idSchema.parse(ruleId), actor.id);
  revalidatePath(`/services/${serviceId}`);
}
export async function duplicateRuleAction(serviceId: string, ruleId: string) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const { duplicateServiceRule } = await import('@/lib/runbooks/bindings');
  await duplicateServiceRule(serviceId, idSchema.parse(ruleId), actor.id);
  revalidatePath(`/services/${serviceId}`);
}

export async function validateRuleConfigurationAction(serviceId: string, ruleId: string) {
  await Promise.all([
    assertCanViewService(idSchema.parse(serviceId)),
    assertCapability(CAPABILITIES.RUNBOOK_READ_ALL),
  ]);
  const rule = await prisma.serviceAutomationRule.findFirst({
    where: { id: idSchema.parse(ruleId), serviceId },
    include: {
      runbook: { include: { publishedVersion: { include: { inputs: true } } } },
      runbookVersion: { include: { inputs: true } },
      triggers: { include: { conditions: true } },
    },
  });
  if (!rule) throw new Error('Service automation rule not found.');
  const { getBindingReadiness } = await import('@/lib/runbooks/binding-readiness');
  // Assess the prospective configuration without activating a paused rule.
  return getBindingReadiness({ ...rule, enabled: true });
}

async function serviceExecutionRequest(serviceId: string, ruleId: string, readOnly: boolean) {
  const [actor] = await Promise.all([
    assertCapability(CAPABILITIES.RUNBOOK_EXECUTE),
    assertCanViewService(idSchema.parse(serviceId)),
  ]);
  const rule = await prisma.serviceAutomationRule.findFirst({
    where: { id: idSchema.parse(ruleId), serviceId, enabled: true },
    include: {
      runbook: { include: { publishedVersion: { include: { inputs: true } } } },
      runbookVersion: { include: { inputs: true } },
    },
  });
  if (!rule) throw new Error('Enable and review this service rule before running it.');
  const version =
    rule.versionStrategy === 'PINNED' ? rule.runbookVersion : rule.runbook.publishedVersion;
  if (!version) throw new Error('A published version is required.');
  if (readOnly) {
    const { flattenSteps, parseRunbookDefinition, minimumRiskForStep } =
      await import('@/lib/runbooks/definition');
    if (
      flattenSteps(parseRunbookDefinition(version.definition, version.inputs)).some(
        step => minimumRiskForStep(step) !== 'READ_ONLY'
      )
    )
      throw new Error(
        'Read-only testing requires a workflow containing only read-only actions. Publish a diagnostic workflow to test this target.'
      );
  }
  return {
    runbookId: rule.runbookId,
    runbookVersionId: version.id,
    bindingId: rule.id,
    serviceId,
    triggeredByUserId: actor.id,
  };
}

export async function previewServiceRuleAction(
  serviceId: string,
  ruleId: string,
  readOnly: boolean
) {
  try {
    const { previewRunbookExecution } = await import('@/lib/runbooks/orchestrator');
    return {
      preview: await previewRunbookExecution(
        await serviceExecutionRequest(serviceId, ruleId, z.boolean().parse(readOnly))
      ),
    };
  } catch (error) {
    const { toPublicAppError } = await import('@/lib/errors');
    return { error: toPublicAppError(error).message };
  }
}

export async function executeServiceRuleAction(
  serviceId: string,
  ruleId: string,
  readOnly: boolean,
  data: FormData
) {
  try {
    const { startRunbookExecution } = await import('@/lib/runbooks/orchestrator');
    await startRunbookExecution({
      ...(await serviceExecutionRequest(serviceId, ruleId, z.boolean().parse(readOnly))),
      expectedPlanDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(data.get('previewDigest')),
      previewAuthorizationToken: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(data.get('previewAuthorizationToken')),
    });
    revalidatePath(`/services/${serviceId}`);
    revalidatePath(`/services/${serviceId}/automations/${ruleId}`);
  } catch (error) {
    const { toPublicAppError } = await import('@/lib/errors');
    return { error: toPublicAppError(error).message };
  }
}

export async function attachRunbookAction(serviceId: string, formData: FormData) {
  try {
    return await attachRunbook(serviceId, formData);
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    if (error instanceof z.ZodError)
      return { error: 'Review the selected version, inputs and target.', field: 'configuration' };
    throw error;
  }
}
export async function updateRunbookBindingAction(
  serviceId: string,
  bindingId: string,
  formData: FormData
) {
  try {
    return await updateRunbookBinding(serviceId, bindingId, formData);
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    if (error instanceof z.ZodError)
      return { error: 'Review the selected version, inputs and target.', field: 'configuration' };
    throw error;
  }
}

export async function activateRuleAction(serviceId: string, ruleId: string, formData: FormData) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const { activateServiceRule } = await import('@/lib/runbooks/bindings');
  try {
    const result = await activateServiceRule(
      serviceId,
      idSchema.parse(ruleId),
      actor.id,
      formData.get('confirmMatchAll') === 'true'
    );
    revalidatePath(`/services/${serviceId}`);
    revalidatePath(`/services/${serviceId}/automations/${ruleId}`);
    return result;
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    throw error;
  }
}
