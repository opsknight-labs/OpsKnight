/**
 * Pure helpers shared by the Service → Runbooks binding UI and its server actions.
 * No server-only imports: this module is bundled into client components.
 */
import {
  AUTOMATION_OPERATORS_BY_TYPE,
  VALUELESS_OPERATORS,
  contextTypeCompatibleWithInput,
} from '@/lib/runbooks/automation-binding';

export { contextTypeCompatibleWithInput };

export type AutomationContextMode = 'DISABLED' | 'SHADOW' | 'LIVE';

export type ContextFieldOption = {
  key: string;
  label: string;
  type: 'STRING' | 'ENUM' | 'NUMBER' | 'BOOLEAN';
  caseSensitive?: boolean;
  allowedValues?: string[];
};

export type AutomationContextSummary = {
  mode: AutomationContextMode;
  versionNumber: number | null;
  fields: ContextFieldOption[];
};

export const CONTEXT_FIELD_PATTERN = /^automation\.([a-z][a-z0-9_]{0,63})$/;

export const CONTEXT_CONDITION_WARNING =
  'Automation context conditions match only incidents routed by a LIVE automation version; otherwise the rule does not fire and a skip reason is recorded.';

export const CONDITION_OPERATOR_LABELS: ReadonlyMap<string, string> = new Map([
  ['EQUALS', 'Equals'],
  ['NOT_EQUALS', 'Does not equal'],
  ['CONTAINS', 'Contains'],
  ['STARTS_WITH', 'Starts with'],
  ['IN', 'Is one of'],
  ['NOT_IN', 'Is not one of'],
  ['EXISTS', 'Exists'],
  ['NOT_EXISTS', 'Does not exist'],
  ['IS_MISSING', 'Is missing'],
  ['IS_UNMAPPED', 'Is unmapped'],
]);

const INCIDENT_OPERATORS = [
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'STARTS_WITH',
  'IN',
  'NOT_IN',
  'EXISTS',
  'NOT_EXISTS',
];

export function contextFieldKey(field: string): string | null {
  return CONTEXT_FIELD_PATTERN.exec(field)?.[1] ?? null;
}

export function operatorLabel(operator: string, field?: ContextFieldOption): string {
  if (field && operator === 'EXISTS') return 'Is recognized';
  return CONDITION_OPERATOR_LABELS.get(operator) ?? operator;
}

/** Automation fields never offer NOT_EXISTS: missing/unmapped states are explicit operators. */
export function operatorsForContextField(field: ContextFieldOption | undefined): string[] {
  if (!field) return INCIDENT_OPERATORS;
  return [...AUTOMATION_OPERATORS_BY_TYPE[field.type]];
}

export function isValuelessOperator(operator: string): boolean {
  return VALUELESS_OPERATORS.has(operator);
}

type ConditionScalar = string | number | boolean;
type CoercionResult = { value: ConditionScalar | ConditionScalar[] | null } | { error: string };

function coerceScalar(field: ContextFieldOption, raw: string): ConditionScalar | Error {
  const text = raw.trim();
  if (text === '') return new Error(`Provide a value for ${field.label}.`);
  if (field.type === 'NUMBER') {
    const number = Number(text);
    return Number.isFinite(number) ? number : new Error(`${field.label} expects a number.`);
  }
  if (field.type === 'BOOLEAN') {
    const lower = text.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    return new Error(`${field.label} expects true or false.`);
  }
  if (field.type === 'ENUM') {
    const allowed = field.allowedValues ?? [];
    const canonical = allowed.find(choice =>
      field.caseSensitive ? choice === text : choice.toLowerCase() === text.toLowerCase()
    );
    return canonical ?? new Error(`"${text}" is not an allowed value for ${field.label}.`);
  }
  // Automation stores case-insensitive text fields lower-cased; compare against the same form.
  return field.caseSensitive ? text : text.toLowerCase();
}

/**
 * Convert a submitted condition value into the type the automation context stores, so the
 * strict runtime comparison can actually match.
 */
export function coerceContextConditionValue(
  field: ContextFieldOption,
  operator: string,
  raw: string
): CoercionResult {
  if (!operatorsForContextField(field).includes(operator)) {
    return {
      error: `${operatorLabel(operator, field)} is not supported for ${field.label}.`,
    };
  }
  if (isValuelessOperator(operator)) return { value: null };
  if (operator === 'IN' || operator === 'NOT_IN') {
    const items = raw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    if (items.length === 0) return { error: `Provide at least one value for ${field.label}.` };
    const values: ConditionScalar[] = [];
    for (const item of items) {
      const coerced = coerceScalar(field, item);
      if (coerced instanceof Error) return { error: coerced.message };
      values.push(coerced);
    }
    return { value: values };
  }
  const coerced = coerceScalar(field, raw);
  return coerced instanceof Error ? { error: coerced.message } : { value: coerced };
}
