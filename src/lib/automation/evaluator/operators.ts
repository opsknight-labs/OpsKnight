import type { Condition, FieldState, Truth } from '../contract';
export function evaluateOperator(field: FieldState, condition: Condition): Truth {
  const op = condition.operator;
  if (op === 'IS_SET') return field.state === 'MISSING' ? 'FALSE' : 'TRUE';
  if (op === 'IS_MISSING') return field.state === 'MISSING' ? 'TRUE' : 'FALSE';
  if (op === 'IS_UNMAPPED') return field.state === 'UNMAPPED' ? 'TRUE' : 'FALSE';
  if (field.state !== 'RECOGNIZED') return op === 'EQ' || op === 'IN' ? 'FALSE' : 'UNKNOWN';
  const value = condition.value;
  const actual = field.value;
  let result: boolean;
  switch (op) {
    case 'EQ':
      result = actual === value;
      break;
    case 'NE':
      result = actual !== value;
      break;
    case 'IN':
      result = Array.isArray(value) && value.includes(actual);
      break;
    case 'NOT_IN':
      result = Array.isArray(value) && !value.includes(actual);
      break;
    default:
      if (typeof actual !== 'number' || typeof value !== 'number') return 'UNKNOWN';
      result =
        op === 'LT'
          ? actual < value
          : op === 'LTE'
            ? actual <= value
            : op === 'GT'
              ? actual > value
              : actual >= value;
  }
  return result ? 'TRUE' : 'FALSE';
}
