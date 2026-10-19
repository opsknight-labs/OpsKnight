import {
  conditionOperatorSchema,
  isAutomationOnlyOperator,
  triggerConditionFieldSchema,
} from './conditions';
import {
  VALUELESS_OPERATORS,
  evaluateAutomationCondition,
  isAutomationConditionField,
  type AutomationContextField,
} from './automation-binding';
import { RunbookDefinitionError } from './errors';
import type { RunbookConditionLogic, RunbookConditionOperator } from './types';

export type TriggerCondition = {
  field: string;
  operator: RunbookConditionOperator;
  value: unknown;
};

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    // Inspect own data properties only; never traverse prototypes or invoke accessors.
    return Object.getOwnPropertyDescriptor(current, segment)?.value as unknown;
  }, source);
}

function asComparableList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function isValidNumericString(str: string): boolean {
  const trimmed = str.trim();
  if (trimmed === '') return false;
  try {
    // JSON's numeric grammar rejects leading zeros, hex, incomplete fractions and signs.
    return typeof JSON.parse(trimmed) === 'number';
  } catch {
    return false;
  }
}

export function normalizeComparisonPair(actual: unknown, expected: unknown): [unknown, unknown] {
  if (typeof actual === 'number' && typeof expected === 'string') {
    if (isValidNumericString(expected)) {
      return [actual, Number(expected.trim())];
    }
  }
  if (typeof actual === 'string' && typeof expected === 'number') {
    if (isValidNumericString(actual)) {
      return [Number(actual.trim()), expected];
    }
  }
  if (typeof actual === 'boolean' && typeof expected === 'string') {
    const lower = expected.trim().toLowerCase();
    if (lower === 'true') return [actual, true];
    if (lower === 'false') return [actual, false];
  }
  if (typeof actual === 'string' && typeof expected === 'boolean') {
    const lower = actual.trim().toLowerCase();
    if (lower === 'true') return [true, expected];
    if (lower === 'false') return [false, expected];
  }
  return [actual, expected];
}

export function areEqual(a: unknown, b: unknown, allowTypeCoercion = false): boolean {
  if (a === b) return true;
  if (!allowTypeCoercion) return false;
  const [normA, normB] = normalizeComparisonPair(a, b);
  return normA === normB;
}

export function matchesCondition(
  context: Record<string, unknown>,
  condition: TriggerCondition,
  inputTypes?: Record<string, string> | Map<string, string>
): boolean {
  const actual = readPath(context, condition.field);
  const isMissing = actual === undefined || actual === null;

  if (condition.operator === 'EXISTS') {
    return !isMissing;
  }
  if (condition.operator === 'NOT_EXISTS') {
    return isMissing;
  }

  // Value-evaluating operators: missing or unmapped fields evaluate to UNKNOWN (false).
  // Absence of data must never satisfy negative comparisons (e.g. NOT_EQUALS, NOT_IN).
  if (isMissing) {
    return false;
  }

  const isTypedInputField =
    condition.field.startsWith('input.') || condition.field.startsWith('inputs.');

  const resolvedInputTypes =
    inputTypes ??
    (context.__inputTypes as Record<string, string> | Map<string, string> | undefined);

  let declaredType: string | undefined = undefined;
  if (isTypedInputField && resolvedInputTypes) {
    const inputKey = condition.field.replace(/^inputs?\./, '');
    declaredType =
      resolvedInputTypes instanceof Map
        ? resolvedInputTypes.get(inputKey)
        : Object.entries(resolvedInputTypes).find(([key]) => key === inputKey)?.[1];
  }

  // Coercion is only allowed for typed inputs that are not declared as STRING.
  const allowCoercion = isTypedInputField && declaredType !== 'STRING';

  switch (condition.operator) {
    case 'EQUALS':
      return areEqual(actual, condition.value, allowCoercion);
    case 'NOT_EQUALS':
      return !areEqual(actual, condition.value, allowCoercion);
    case 'CONTAINS': {
      if (typeof actual === 'string') {
        if (
          (!isTypedInputField || declaredType === 'STRING') &&
          typeof condition.value !== 'string'
        ) {
          return false;
        }
        const valStr =
          typeof condition.value === 'string' ? condition.value : String(condition.value);
        return actual.includes(valStr);
      }
      if (Array.isArray(actual)) {
        if (!isTypedInputField && typeof condition.value !== 'string') {
          return false;
        }
        return actual.some(item => areEqual(item, condition.value, allowCoercion));
      }
      return false;
    }
    case 'STARTS_WITH': {
      if (typeof actual === 'string') {
        if (
          (!isTypedInputField || declaredType === 'STRING') &&
          typeof condition.value !== 'string'
        ) {
          return false;
        }
        const valStr =
          typeof condition.value === 'string' ? condition.value : String(condition.value);
        return actual.startsWith(valStr);
      }
      return false;
    }
    case 'IN':
      return asComparableList(condition.value).some(item => areEqual(actual, item, allowCoercion));
    case 'NOT_IN':
      return !asComparableList(condition.value).some(item => areEqual(actual, item, allowCoercion));
    case 'IS_MISSING':
    case 'IS_UNMAPPED':
      return false;
  }
}

export function matchesTrigger(
  context: Record<string, unknown>,
  conditions: TriggerCondition[],
  logic: RunbookConditionLogic,
  inputTypes?: Record<string, string> | Map<string, string>
): boolean {
  if (conditions.length === 0) return true;
  return logic === 'AND'
    ? conditions.every(condition => matchesCondition(context, condition, inputTypes))
    : conditions.some(condition => matchesCondition(context, condition, inputTypes));
}

/** Verified automation context as seen by trigger matching; null fields mean UNAVAILABLE. */
export type TriggerAutomationContext = {
  available: boolean;
  reason: string | null;
  fields: ReadonlyArray<AutomationContextField> | null;
};

export type TriggerEvaluation =
  | { status: 'MATCHED'; reason: string }
  | { status: 'NOT_MATCHED' }
  | { status: 'CONTEXT_UNAVAILABLE'; reason: string }
  | { status: 'CONFIG_INVALID'; reason: string };

function describe(condition: TriggerCondition): string {
  const value = VALUELESS_OPERATORS.has(condition.operator)
    ? ''
    : ` ${JSON.stringify(condition.value)?.slice(0, 200) ?? ''}`;
  return `${condition.field} ${condition.operator}${value}`;
}

/**
 * Validates every stored condition (including legacy rows) before evaluating AND/OR.
 * Rules referencing `automation.*` never fire without verified context, and become
 * configuration-invalid (never reinterpreted) when a referenced field disappears.
 */
export function evaluateTrigger(
  context: Record<string, unknown> & { automation?: TriggerAutomationContext },
  conditions: TriggerCondition[],
  logic: RunbookConditionLogic
): TriggerEvaluation {
  if (
    !['AND', 'OR'].includes(logic) ||
    conditions.some(
      condition =>
        !triggerConditionFieldSchema.safeParse(condition.field).success ||
        !conditionOperatorSchema.safeParse(condition.operator).success ||
        (!isAutomationConditionField(condition.field) &&
          isAutomationOnlyOperator(condition.operator))
    )
  ) {
    throw new RunbookDefinitionError(
      'Trigger has an unsupported condition field, operator or logic.'
    );
  }
  const automationConditions = conditions.filter(condition =>
    isAutomationConditionField(condition.field)
  );
  const automation = context.automation;
  if (automationConditions.length && (!automation?.available || !automation.fields))
    return {
      status: 'CONTEXT_UNAVAILABLE',
      reason: `AUTOMATION_CONTEXT_UNAVAILABLE: ${automation?.reason ?? 'NO_LIVE_DECISION'}`,
    };
  const results: boolean[] = [];
  for (const condition of conditions) {
    if (isAutomationConditionField(condition.field)) {
      const outcome = evaluateAutomationCondition(condition, automation!.fields!);
      if (outcome.kind === 'INVALID') return { status: 'CONFIG_INVALID', reason: outcome.reason };
      results.push(outcome.matched);
    } else {
      results.push(matchesCondition(context, condition));
    }
  }
  const matched =
    conditions.length === 0 || (logic === 'AND' ? results.every(Boolean) : results.some(Boolean));
  if (!matched) return { status: 'NOT_MATCHED' };
  const matchedConditions = conditions.filter((_, index) => results.at(index));
  return {
    status: 'MATCHED',
    reason: conditions.length
      ? `${logic}: ${matchedConditions.map(describe).join('; ')}`
      : 'No conditions: every incident matches.',
  };
}

export function validateAndMatchTrigger(
  context: Record<string, unknown> & { automation?: TriggerAutomationContext },
  conditions: TriggerCondition[],
  logic: RunbookConditionLogic
): boolean {
  return evaluateTrigger(context, conditions, logic).status === 'MATCHED';
}
