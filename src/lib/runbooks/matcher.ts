import type { RunbookConditionLogic, RunbookConditionOperator } from './types';

export type TriggerCondition = {
  field: string;
  operator: RunbookConditionOperator;
  value: unknown;
};

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    // The own-property guard above prevents prototype traversal.
    // eslint-disable-next-line security/detect-object-injection
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function asComparableList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function isValidNumericString(str: string): boolean {
  const trimmed = str.trim();
  if (trimmed === '' || Number.isNaN(Number(trimmed))) return false;
  return /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed);
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
  condition: TriggerCondition
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

  switch (condition.operator) {
    case 'EQUALS':
      return areEqual(actual, condition.value, isTypedInputField);
    case 'NOT_EQUALS':
      return !areEqual(actual, condition.value, isTypedInputField);
    case 'CONTAINS': {
      if (typeof actual === 'string') {
        const valStr =
          typeof condition.value === 'string' ? condition.value : String(condition.value);
        return actual.includes(valStr);
      }
      if (Array.isArray(actual)) {
        return actual.some(item => areEqual(item, condition.value, isTypedInputField));
      }
      return false;
    }
    case 'STARTS_WITH': {
      if (typeof actual === 'string') {
        const valStr =
          typeof condition.value === 'string' ? condition.value : String(condition.value);
        return actual.startsWith(valStr);
      }
      return false;
    }
    case 'IN':
      return asComparableList(condition.value).some(item =>
        areEqual(actual, item, isTypedInputField)
      );
    case 'NOT_IN':
      return !asComparableList(condition.value).some(item =>
        areEqual(actual, item, isTypedInputField)
      );
  }
}

export function matchesTrigger(
  context: Record<string, unknown>,
  conditions: TriggerCondition[],
  logic: RunbookConditionLogic
): boolean {
  if (conditions.length === 0) return true;
  return logic === 'AND'
    ? conditions.every(condition => matchesCondition(context, condition))
    : conditions.some(condition => matchesCondition(context, condition));
}
