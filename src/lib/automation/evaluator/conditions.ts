import type { Context, Rule } from '../contract';
import { and } from '../semantics';
import { evaluateOperator } from './operators';
export function evaluateConditions(
  context: Context,
  rule: Rule,
  guard?: (conditionIndex: number) => void
) {
  const terms = rule.conditions.map((condition, conditionIndex) => {
    guard?.(conditionIndex);
    const result = evaluateOperator(context[condition.fieldKey] ?? { state: 'MISSING' }, condition);
    guard?.(conditionIndex);
    return { condition, result };
  });
  return { ruleId: rule.id, ruleName: rule.name, result: and(terms.map(t => t.result)), terms };
}
