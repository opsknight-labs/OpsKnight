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
      return actual === condition.value;
    case 'NOT_EQUALS':
      return actual !== condition.value;
    case 'CONTAINS':
      return typeof actual === 'string' && typeof condition.value === 'string'
        ? actual.includes(condition.value)
        : Array.isArray(actual) && actual.includes(condition.value);
    case 'STARTS_WITH':
      return (
        typeof actual === 'string' &&
        typeof condition.value === 'string' &&
        actual.startsWith(condition.value)
      );
    case 'IN':
      return asComparableList(condition.value).includes(actual);
    case 'NOT_IN':
      return !asComparableList(condition.value).includes(actual);
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
