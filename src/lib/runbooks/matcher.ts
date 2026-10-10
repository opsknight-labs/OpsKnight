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

export function normalizeComparisonPair(actual: unknown, expected: unknown): [unknown, unknown] {
  if (typeof actual === 'number' && typeof expected === 'string') {
    const trimmed = expected.trim();
    if (trimmed !== '' && !Number.isNaN(Number(trimmed))) {
      return [actual, Number(trimmed)];
    }
  }
  if (typeof actual === 'string' && typeof expected === 'number') {
    const trimmed = actual.trim();
    if (trimmed !== '' && !Number.isNaN(Number(trimmed))) {
      return [Number(trimmed), expected];
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

export function areEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
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

  switch (condition.operator) {
    case 'EQUALS':
      return areEqual(actual, condition.value);
    case 'NOT_EQUALS':
      return !areEqual(actual, condition.value);
    case 'CONTAINS': {
      if (typeof actual === 'string') {
        const valStr =
          typeof condition.value === 'string' ? condition.value : String(condition.value);
        return actual.includes(valStr);
      }
      if (Array.isArray(actual)) {
        return actual.some(item => areEqual(item, condition.value));
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
      return asComparableList(condition.value).some(item => areEqual(actual, item));
    case 'NOT_IN':
      return !asComparableList(condition.value).some(item => areEqual(actual, item));
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
