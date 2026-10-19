/**
 * Pure, client-safe rules for Service Automation context in runbook bindings:
 * `automation.<key>` trigger conditions, context → input mappings and approved target mappings.
 */
import { z } from 'zod';
import { isValidInputValue } from './input-values';
import type { RunbookConditionOperator, RunbookInputType } from './types';

export const AUTOMATION_FIELD_KEY = /^[a-z][a-z0-9_]{0,63}$/;
export const AUTOMATION_CONDITION_FIELD = /^automation\.([a-z][a-z0-9_]{0,63})$/;
export const AUTOMATION_FIELD_TYPES = ['STRING', 'ENUM', 'NUMBER', 'BOOLEAN'] as const;
export type AutomationFieldType = (typeof AUTOMATION_FIELD_TYPES)[number];
export type AutomationScalar = string | number | boolean;

/** Authoring view of a published automation field. */
export type AutomationFieldDefinition = {
  key: string;
  type: AutomationFieldType;
  caseSensitive?: boolean;
  allowedValues?: string[];
};

/** Captured, checksum-verified field of an incident's response context. */
export type AutomationContextField = {
  key: string;
  type: AutomationFieldType;
  state: 'RECOGNIZED' | 'MISSING' | 'UNMAPPED';
  value: AutomationScalar | null;
};

export function automationFieldKey(field: string): string | null {
  return AUTOMATION_CONDITION_FIELD.exec(field)?.[1] ?? null;
}

export const isAutomationConditionField = (field: string) => AUTOMATION_CONDITION_FIELD.test(field);

const STATE_OPERATORS = ['EXISTS', 'IS_MISSING', 'IS_UNMAPPED'] as const;
const EQUALITY_OPERATORS = ['EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN'] as const;

/** `EXISTS` means RECOGNIZED. `NOT_EXISTS` is intentionally absent: use IS_MISSING / IS_UNMAPPED. */
export const AUTOMATION_OPERATORS_BY_TYPE: Readonly<
  Record<AutomationFieldType, readonly RunbookConditionOperator[]>
> = {
  STRING: [...EQUALITY_OPERATORS, 'CONTAINS', 'STARTS_WITH', ...STATE_OPERATORS],
  ENUM: [...EQUALITY_OPERATORS, ...STATE_OPERATORS],
  NUMBER: [...EQUALITY_OPERATORS, ...STATE_OPERATORS],
  BOOLEAN: ['EQUALS', 'NOT_EQUALS', ...STATE_OPERATORS],
};

export const VALUELESS_OPERATORS: ReadonlySet<string> = new Set([
  'EXISTS',
  'NOT_EXISTS',
  'IS_MISSING',
  'IS_UNMAPPED',
]);
const LIST_OPERATORS: ReadonlySet<string> = new Set(['IN', 'NOT_IN']);

function scalarMatchesType(type: AutomationFieldType, value: unknown): value is AutomationScalar {
  if (type === 'NUMBER') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'BOOLEAN') return typeof value === 'boolean';
  return typeof value === 'string' && value.length > 0 && value.length <= 2048;
}

/** Canonical stored form of an authored scalar, or null when it is not valid for the field. */
export function canonicalAutomationValue(
  field: AutomationFieldDefinition,
  value: unknown
): AutomationScalar | null {
  if (!scalarMatchesType(field.type, value)) return null;
  if (field.type === 'ENUM') {
    const allowed = field.allowedValues ?? [];
    const text = value as string;
    return (
      allowed.find(choice =>
        field.caseSensitive ? choice === text : choice.toLowerCase() === text.toLowerCase()
      ) ?? null
    );
  }
  if (field.type === 'STRING' && !field.caseSensitive) return (value as string).toLowerCase();
  return value;
}

/**
 * Authoring-time validation against the service's published automation schema.
 * Returns the canonical value to store, or an actionable error.
 */
export function validateAutomationCondition(
  condition: { field: string; operator: string; value?: unknown },
  fields: ReadonlyArray<AutomationFieldDefinition>
):
  { ok: true; value: AutomationScalar | AutomationScalar[] | null } | { ok: false; error: string } {
  const key = automationFieldKey(condition.field);
  if (!key) return { ok: false, error: `Unsupported automation field "${condition.field}".` };
  const field = fields.find(candidate => candidate.key === key);
  if (!field)
    return {
      ok: false,
      error: `automation.${key} is not published in this service's automation schema.`,
    };
  if (!AUTOMATION_OPERATORS_BY_TYPE[field.type].includes(condition.operator as never))
    return {
      ok: false,
      error: `Operator ${condition.operator} is not supported for ${field.type} field automation.${key}.`,
    };
  if (VALUELESS_OPERATORS.has(condition.operator)) return { ok: true, value: null };
  const list = LIST_OPERATORS.has(condition.operator);
  const raw = list ? condition.value : [condition.value];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200)
    return { ok: false, error: `Provide 1–200 values for automation.${key}.` };
  const canonical: AutomationScalar[] = [];
  for (const item of raw) {
    const value = canonicalAutomationValue(field, item);
    if (value === null)
      return {
        ok: false,
        error:
          field.type === 'ENUM'
            ? `"${String(item).slice(0, 80)}" is not an allowed value for automation.${key}.`
            : `automation.${key} expects ${field.type.toLowerCase()} values.`,
      };
    canonical.push(value);
  }
  return { ok: true, value: list ? canonical : canonical[0] };
}

export type AutomationConditionOutcome =
  { kind: 'RESULT'; matched: boolean } | { kind: 'INVALID'; reason: string };

/**
 * Runtime evaluation against the verified context. MISSING / UNMAPPED never satisfy value
 * comparisons (positive or negative). A field the captured schema no longer declares, or
 * whose type changed, makes the rule configuration-invalid instead of being reinterpreted.
 */
export function evaluateAutomationCondition(
  condition: { field: string; operator: string; value: unknown },
  fields: ReadonlyArray<AutomationContextField>
): AutomationConditionOutcome {
  const key = automationFieldKey(condition.field);
  const field = key ? fields.find(candidate => candidate.key === key) : undefined;
  if (!key || !field)
    return {
      kind: 'INVALID',
      reason: `AUTOMATION_FIELD_REMOVED: ${condition.field} is not declared by the incident's automation schema.`,
    };
  if (!AUTOMATION_OPERATORS_BY_TYPE[field.type].includes(condition.operator as never))
    return {
      kind: 'INVALID',
      reason: `AUTOMATION_OPERATOR_INVALID: ${condition.operator} is not valid for ${field.type} field ${condition.field}.`,
    };
  if (condition.operator === 'IS_MISSING')
    return { kind: 'RESULT', matched: field.state === 'MISSING' };
  if (condition.operator === 'IS_UNMAPPED')
    return { kind: 'RESULT', matched: field.state === 'UNMAPPED' };
  const expected = LIST_OPERATORS.has(condition.operator)
    ? condition.value
    : condition.operator === 'EXISTS'
      ? []
      : [condition.value];
  const comparisonType = field.type === 'ENUM' ? 'STRING' : field.type;
  if (!Array.isArray(expected) || expected.some(item => !scalarMatchesType(comparisonType, item)))
    return {
      kind: 'INVALID',
      reason: `AUTOMATION_FIELD_TYPE_CHANGED: ${condition.field} is now ${field.type}; the rule's comparison values no longer match.`,
    };
  if (field.state !== 'RECOGNIZED' || field.value === null)
    return { kind: 'RESULT', matched: false };
  const actual = field.value;
  switch (condition.operator) {
    case 'EXISTS':
      return { kind: 'RESULT', matched: true };
    case 'EQUALS':
    case 'IN':
      return { kind: 'RESULT', matched: expected.some(item => item === actual) };
    case 'NOT_EQUALS':
    case 'NOT_IN':
      return { kind: 'RESULT', matched: !expected.some(item => item === actual) };
    case 'CONTAINS':
      return {
        kind: 'RESULT',
        matched: typeof actual === 'string' && actual.includes(expected[0] as string),
      };
    case 'STARTS_WITH':
      return {
        kind: 'RESULT',
        matched: typeof actual === 'string' && actual.startsWith(expected[0] as string),
      };
    default:
      return { kind: 'RESULT', matched: false };
  }
}

// ---------------------------------------------------------------------------
// Context → input mappings
// ---------------------------------------------------------------------------

export const contextInputMappingsSchema = z
  .array(
    z
      .object({
        inputKey: z
          .string()
          .max(80)
          .regex(/^[a-z0-9_]+$/),
        contextKey: z.string().regex(AUTOMATION_FIELD_KEY),
      })
      .strict()
  )
  .max(50)
  .superRefine((mappings, ctx) => {
    const seen = new Set<string>();
    mappings.forEach((mapping, index) => {
      if (seen.has(mapping.inputKey))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'inputKey'],
          message: `Input "${mapping.inputKey}" is mapped more than once.`,
        });
      seen.add(mapping.inputKey);
    });
  });
export type ContextInputMapping = z.infer<typeof contextInputMappingsSchema>[number];

/** Secrets are never sourced from alert content; they stay on existing secret references. */
export function contextTypeCompatibleWithInput(
  contextType: AutomationFieldType,
  inputType: RunbookInputType | 'SELECT'
): boolean {
  switch (inputType) {
    case 'STRING':
    case 'SELECT':
    case 'URL':
    case 'DURATION':
      return contextType === 'STRING' || contextType === 'ENUM';
    case 'NUMBER':
      return contextType === 'NUMBER';
    case 'BOOLEAN':
      return contextType === 'BOOLEAN';
    default:
      return false;
  }
}

export type InputDefinition = {
  key: string;
  type: RunbookInputType | 'SELECT';
  required: boolean;
};

export function validateContextInputMappings(
  mappings: ReadonlyArray<ContextInputMapping>,
  inputs: ReadonlyArray<InputDefinition>,
  fields: ReadonlyArray<AutomationFieldDefinition>
): string | null {
  for (const mapping of mappings) {
    const input = inputs.find(candidate => candidate.key === mapping.inputKey);
    if (!input) return `Mapped input "${mapping.inputKey}" is not declared by the runbook version.`;
    const field = fields.find(candidate => candidate.key === mapping.contextKey);
    if (!field)
      return `automation.${mapping.contextKey} is not published in this service's automation schema.`;
    if (!contextTypeCompatibleWithInput(field.type, input.type))
      return `automation.${mapping.contextKey} (${field.type}) cannot supply ${input.type} input "${input.key}".`;
  }
  return null;
}

export type InputProvenance =
  | { source: 'AUTOMATION_CONTEXT'; contextKey: string }
  | { source: 'BINDING' }
  | { source: 'BINDING_DEFAULT_FALLBACK'; contextKey: string; contextState: string };

export type ContextInputResolution =
  | {
      ok: true;
      values: Record<string, unknown>;
      provenance: Record<string, InputProvenance>;
    }
  | { ok: false; reason: string };

/**
 * Resolves mapped inputs from the verified context. A required mapped input that is
 * unavailable/missing/unmapped/invalid blocks execution. Optional ones keep the admin's
 * type-valid binding value (or the version default applied later).
 */
export function resolveContextInputs(input: {
  definitions: ReadonlyArray<InputDefinition>;
  mappings: ReadonlyArray<ContextInputMapping>;
  bindingValues: Record<string, unknown>;
  context: ReadonlyArray<AutomationContextField> | null;
}): ContextInputResolution {
  const values: Record<string, unknown> = { ...input.bindingValues };
  const provenance: Record<string, InputProvenance> = Object.fromEntries(
    Object.keys(values).map(key => [key, { source: 'BINDING' }])
  );
  for (const mapping of input.mappings) {
    const definition = input.definitions.find(candidate => candidate.key === mapping.inputKey);
    if (!definition)
      return {
        ok: false,
        reason: `INPUT_MAPPING_INVALID: mapped input "${mapping.inputKey}" is not declared by the pinned runbook version. Update the binding's input mapping.`,
      };
    const field = input.context?.find(candidate => candidate.key === mapping.contextKey);
    let problem: string | null = null;
    if (!input.context) problem = 'UNAVAILABLE';
    else if (!field) problem = 'REMOVED';
    else if (!contextTypeCompatibleWithInput(field.type, definition.type))
      problem = 'TYPE_MISMATCH';
    else if (field.state !== 'RECOGNIZED') problem = field.state;
    else if (!isValidInputValue(definition.type, field.value)) problem = 'INVALID';
    if (!problem) {
      values[definition.key] = field!.value;
      provenance[definition.key] = { source: 'AUTOMATION_CONTEXT', contextKey: mapping.contextKey };
      continue;
    }
    if (definition.required)
      return {
        ok: false,
        reason: `INPUT_CONTEXT_UNRESOLVED: required input "${definition.key}" maps to automation.${mapping.contextKey}, which is ${problem} for this incident. Fix the alert mapping or remove the input mapping.`,
      };
    if (values[definition.key] !== undefined)
      provenance[definition.key] = {
        source: 'BINDING_DEFAULT_FALLBACK',
        contextKey: mapping.contextKey,
        contextState: problem,
      };
  }
  return { ok: true, values, provenance };
}

// ---------------------------------------------------------------------------
// Approved target mappings
// ---------------------------------------------------------------------------

const targetEntrySchema = z
  .object({
    value: z.union([z.string().min(1).max(2048), z.number().finite(), z.boolean()]),
    agentPoolId: z.string().cuid().optional(),
    agentId: z.string().cuid().optional(),
  })
  .strict()
  .refine(
    entry => Boolean(entry.agentPoolId) !== Boolean(entry.agentId),
    'Each approved value maps to exactly one Agent pool or Agent.'
  );

export const contextTargetMappingSchema = z
  .object({
    contextKey: z.string().regex(AUTOMATION_FIELD_KEY).nullable().default(null),
    entries: z.array(targetEntrySchema).max(100).default([]),
  })
  .strict()
  .superRefine((mapping, ctx) => {
    if (!mapping.contextKey && mapping.entries.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contextKey'],
        message: 'Choose the automation field that selects the target.',
      });
    if (mapping.contextKey && !mapping.entries.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entries'],
        message: 'Add at least one approved value → target row.',
      });
    const seen = new Set<string>();
    mapping.entries.forEach((entry, index) => {
      const id = `${typeof entry.value}:${String(entry.value)}`;
      if (seen.has(id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', index, 'value'],
          message: `Value "${String(entry.value)}" is mapped more than once.`,
        });
      seen.add(id);
    });
  });
export type ContextTargetMapping = z.infer<typeof contextTargetMappingSchema>;

export function parseContextTargetMapping(raw: unknown): ContextTargetMapping | null {
  const parsed = contextTargetMappingSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

export function parseContextInputMappings(raw: unknown): ContextInputMapping[] | null {
  const parsed = contextInputMappingsSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : null;
}

/** Canonicalizes entry values against the published field (ENUM canonical case, etc.). */
export function canonicalizeContextTargetMapping(
  mapping: ContextTargetMapping,
  fields: ReadonlyArray<AutomationFieldDefinition>
): { ok: true; mapping: ContextTargetMapping } | { ok: false; error: string } {
  if (!mapping.contextKey) return { ok: true, mapping: { contextKey: null, entries: [] } };
  const field = fields.find(candidate => candidate.key === mapping.contextKey);
  if (!field)
    return {
      ok: false,
      error: `automation.${mapping.contextKey} is not published in this service's automation schema.`,
    };
  const entries: ContextTargetMapping['entries'] = [];
  const seen = new Set<string>();
  for (const entry of mapping.entries) {
    const value = canonicalAutomationValue(field, entry.value);
    if (value === null)
      return {
        ok: false,
        error: `"${String(entry.value).slice(0, 80)}" is not a valid ${field.type.toLowerCase()} value for automation.${field.key}.`,
      };
    const id = `${typeof value}:${String(value)}`;
    if (seen.has(id))
      return { ok: false, error: `Value "${String(value)}" is mapped more than once.` };
    seen.add(id);
    entries.push({ ...entry, value });
  }
  return { ok: true, mapping: { contextKey: field.key, entries } };
}

export type TargetProvenance =
  | { kind: 'CONTEXT_MAPPING'; contextKey: string; value: AutomationScalar }
  | { kind: 'BINDING_DEFAULT' }
  | { kind: 'RESPONDER_SELECTED' }
  | { kind: 'SUGGESTION_PLAN' }
  | { kind: 'NONE' };

export type ContextTargetResolution =
  | { kind: 'NONE' }
  | {
      kind: 'MAPPED';
      agentId: string | null;
      agentPoolId: string | null;
      contextKey: string;
      value: AutomationScalar;
    }
  | { kind: 'BLOCKED'; reason: string };

/** Never derives a target from alert content: only exact matches of approved values resolve. */
export function resolveContextTarget(
  mapping: ContextTargetMapping | null,
  context: ReadonlyArray<AutomationContextField> | null
): ContextTargetResolution {
  if (!mapping)
    return {
      kind: 'BLOCKED',
      reason: 'TARGET_MAPPING_INVALID: the binding target mapping is malformed.',
    };
  if (!mapping.contextKey) return { kind: 'NONE' };
  const label = `automation.${mapping.contextKey}`;
  if (!context)
    return {
      kind: 'BLOCKED',
      reason: `TARGET_CONTEXT_UNAVAILABLE: ${label} selects the target but verified automation context is unavailable.`,
    };
  const field = context.find(candidate => candidate.key === mapping.contextKey);
  if (!field)
    return {
      kind: 'BLOCKED',
      reason: `TARGET_MAPPING_INVALID: ${label} is no longer declared by the automation schema. Update the target mapping.`,
    };
  if (field.state !== 'RECOGNIZED' || field.value === null)
    return {
      kind: 'BLOCKED',
      reason: `TARGET_CONTEXT_UNRESOLVED: ${label} is ${field.state} for this incident; automatic execution is blocked.`,
    };
  const actual = field.value;
  const entry = mapping.entries.find(candidate => candidate.value === actual);
  if (!entry)
    return {
      kind: 'BLOCKED',
      reason: `TARGET_UNMAPPED_VALUE: ${label}="${String(actual).slice(0, 120)}" has no approved target; automatic execution is blocked. Add it to the approved target table.`,
    };
  return {
    kind: 'MAPPED',
    agentId: entry.agentId ?? null,
    agentPoolId: entry.agentPoolId ?? null,
    contextKey: mapping.contextKey,
    value: actual,
  };
}

/** Every target the binding's admin approved; anything else is rejected at dispatch. */
export function approvedBindingTargets(binding: {
  defaultAgentId: string | null;
  defaultAgentPoolId: string | null;
  contextTargetMappings: unknown;
}): { agentIds: Set<string>; poolIds: Set<string> } {
  const agentIds = new Set<string>();
  const poolIds = new Set<string>();
  if (binding.defaultAgentId) agentIds.add(binding.defaultAgentId);
  if (binding.defaultAgentPoolId) poolIds.add(binding.defaultAgentPoolId);
  for (const entry of parseContextTargetMapping(binding.contextTargetMappings)?.entries ?? []) {
    if (entry.agentId) agentIds.add(entry.agentId);
    if (entry.agentPoolId) poolIds.add(entry.agentPoolId);
  }
  return { agentIds, poolIds };
}

export type BindingAutomationPlan =
  | {
      ok: true;
      inputValues: Record<string, unknown>;
      inputProvenance: Record<string, InputProvenance>;
      agentId: string | null;
      agentPoolId: string | null;
      targetProvenance: TargetProvenance;
    }
  | { ok: false; reason: string };

/** Trigger-sourced plan: context-mapped inputs plus an approved (or default) target. */
export function resolveBindingAutomationPlan(input: {
  definitions: ReadonlyArray<InputDefinition>;
  binding: {
    inputValues: unknown;
    contextInputMappings: unknown;
    contextTargetMappings: unknown;
    defaultAgentId: string | null;
    defaultAgentPoolId: string | null;
  };
  context: ReadonlyArray<AutomationContextField> | null;
}): BindingAutomationPlan {
  const mappings = parseContextInputMappings(input.binding.contextInputMappings);
  if (!mappings)
    return {
      ok: false,
      reason: 'INPUT_MAPPING_INVALID: the binding input mapping is malformed.',
    };
  const bindingValues =
    input.binding.inputValues && typeof input.binding.inputValues === 'object'
      ? (input.binding.inputValues as Record<string, unknown>)
      : {};
  const inputs = resolveContextInputs({
    definitions: input.definitions,
    mappings,
    bindingValues,
    context: input.context,
  });
  if (!inputs.ok) return inputs;
  const target = resolveContextTarget(
    parseContextTargetMapping(input.binding.contextTargetMappings),
    input.context
  );
  if (target.kind === 'BLOCKED') return { ok: false, reason: target.reason };
  if (target.kind === 'MAPPED')
    return {
      ok: true,
      inputValues: inputs.values,
      inputProvenance: inputs.provenance,
      agentId: target.agentId,
      agentPoolId: target.agentPoolId,
      targetProvenance: {
        kind: 'CONTEXT_MAPPING',
        contextKey: target.contextKey,
        value: target.value,
      },
    };
  return {
    ok: true,
    inputValues: inputs.values,
    inputProvenance: inputs.provenance,
    agentId: input.binding.defaultAgentId,
    agentPoolId: input.binding.defaultAgentId ? null : input.binding.defaultAgentPoolId,
    targetProvenance:
      input.binding.defaultAgentId || input.binding.defaultAgentPoolId
        ? { kind: 'BINDING_DEFAULT' }
        : { kind: 'NONE' },
  };
}
