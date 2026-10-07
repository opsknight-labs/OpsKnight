import type { Context, Rule } from '../contract';
import { and } from '../semantics';
import { evaluateOperator } from './operators';
export function evaluateConditions(context: Context, rule: Rule) {
  const terms = rule.conditions.map(condition => ({
    condition,
    result: evaluateOperator(context[condition.fieldKey] ?? { state: 'MISSING' }, condition),
  }));
  return { ruleId: rule.id, ruleName: rule.name, result: and(terms.map(t => t.result)), terms };
}
