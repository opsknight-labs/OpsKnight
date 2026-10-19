import { z } from 'zod';
import { RUNBOOK_CONDITION_OPERATORS } from './types';
import { isAutomationConditionField } from './automation-binding';

export const CONDITION_CONTEXT_FIELDS = [
  'incident.id',
  'incident.title',
  'incident.description',
  'incident.status',
  'incident.urgency',
  'incident.priority',
  'incident.tags',
  'service.id',
  'service.name',
  'service.teamId',
] as const;

export function canonicalConditionField(field: string): string {
  if (field.startsWith('inputs.')) return field.replace(/^inputs\./, 'input.');
  return ['priority', 'urgency', 'status', 'title', 'description', 'tags'].includes(field)
    ? `incident.${field}`
    : field;
}

export const conditionOperatorSchema = z.enum(RUNBOOK_CONDITION_OPERATORS);
export const conditionContextFieldSchema = z.enum(CONDITION_CONTEXT_FIELDS);

export { isAutomationConditionField };
/** Context-state operators exist only for `automation.<key>` trigger conditions. */
export const isAutomationOnlyOperator = (operator: string) =>
  operator === 'IS_MISSING' || operator === 'IS_UNMAPPED';
export const triggerConditionFieldSchema = z
  .string()
  .refine(
    field => conditionContextFieldSchema.safeParse(field).success || isAutomationConditionField(field),
    'Unsupported trigger condition field'
  );
export const workflowConditionSchema = z.object({
  field: z
    .string()
    .transform(canonicalConditionField)
    .refine(
      field =>
        conditionContextFieldSchema.safeParse(field).success || /^input\.[a-z0-9_]+$/.test(field),
      'Unsupported CONDITION field'
    ),
  operator: conditionOperatorSchema
    .refine(operator => !isAutomationOnlyOperator(operator), 'Unsupported CONDITION operator')
    .default('EQUALS'),
  value: z.unknown().optional(),
});

export type ConditionValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'TAGS';

export function conditionValueType(
  field: string,
  inputs: ReadonlyArray<{ key: string; type: string }>,
  contextFields: ReadonlyArray<{ key: string; type: string }> = []
): ConditionValueType {
  if (field === 'incident.tags') return 'TAGS';
  if (isAutomationConditionField(field)) {
    const contextField = contextFields.find(candidate => field === `automation.${candidate.key}`);
    return contextField?.type === 'NUMBER' || contextField?.type === 'BOOLEAN'
      ? contextField.type
      : 'STRING';
  }
  const input = inputs.find(
    input => field === `input.${input.key}` || field === `inputs.${input.key}`
  );
  return input?.type === 'NUMBER' || input?.type === 'BOOLEAN' ? input.type : 'STRING';
}

export function supportedConditionOperators(type: ConditionValueType): readonly string[] {
  const common = ['EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'EXISTS', 'NOT_EXISTS'];
  return type === 'STRING'
    ? [...common, 'CONTAINS', 'STARTS_WITH']
    : type === 'TAGS'
      ? ['CONTAINS', 'EXISTS', 'NOT_EXISTS']
      : common;
}

/** Conversion belongs to authoring. Runtime/incident-trigger comparisons stay strict. */
export function normalizeConditionValue({
  previousValue,
  nextType,
  operator,
}: {
  previousValue: unknown;
  previousType: ConditionValueType;
  nextType: ConditionValueType;
  operator: string;
}): unknown {
  if (['EXISTS', 'NOT_EXISTS'].includes(operator)) return undefined;
  const scalar = (value: unknown): unknown => {
    if (value === undefined || value === null) return undefined;
    if (nextType === 'NUMBER') {
      const text = String(value).trim();
      return text !== '' && Number.isFinite(Number(text)) ? Number(text) : undefined;
    }
    if (nextType === 'BOOLEAN') {
      if (value === true || value === 'true') return true;
      if (value === false || value === 'false') return false;
      return undefined;
    }
    return String(value);
  };
  if (['IN', 'NOT_IN'].includes(operator)) {
    const list = Array.isArray(previousValue)
      ? previousValue
      : previousValue === undefined
        ? []
        : [previousValue];
    const converted = list.map(scalar);
    return converted.some(value => value === undefined) ? undefined : converted;
  }
  return scalar(Array.isArray(previousValue) ? previousValue.at(0) : previousValue);
}

export function validateConditionComparison(
  config: Record<string, unknown>,
  type: ConditionValueType,
  inputs: ReadonlyArray<{ key: string; type?: string }> = []
): string | undefined {
  const operator = String(config.operator ?? 'EQUALS');
  if (!supportedConditionOperators(type).includes(operator))
    return `Operator ${operator} is not supported for ${type}.`;
  if (['EXISTS', 'NOT_EXISTS'].includes(operator)) return undefined;
  const values = ['IN', 'NOT_IN'].includes(operator) ? config.value : [config.value];
  if (!Array.isArray(values) || values.length === 0) return 'Provide a non-empty comparison list.';
  const expectedType = type === 'NUMBER' ? 'number' : type === 'BOOLEAN' ? 'boolean' : 'string';
  if (
    values.some(value => {
      const template =
        typeof value === 'string' ? /^\$\{\{\s*inputs\.([a-z0-9_]+)\s*\}\}$/.exec(value) : null;
      if (template) {
        const input = inputs.find(input => input.key === template[1]);
        return (
          !input ||
          (expectedType === 'number'
            ? input.type !== 'NUMBER'
            : expectedType === 'boolean'
              ? input.type !== 'BOOLEAN'
              : ['NUMBER', 'BOOLEAN'].includes(input.type ?? 'STRING'))
        );
      }
      return (
        typeof value !== expectedType || (typeof value === 'number' && !Number.isFinite(value))
      );
    })
  ) {
    return `Comparison values must be ${expectedType}s.`;
  }
  return undefined;
}
