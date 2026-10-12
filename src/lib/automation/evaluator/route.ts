import type { EvaluationGuard } from './guard';
import type { CompiledSnapshot, Context, Route, SupplementalAction } from '../contract';
import { evaluateConditions } from './conditions';
export function evaluateRouting(
  version: CompiledSnapshot,
  context: Context,
  guard: EvaluationGuard
) {
  const results: ReturnType<typeof evaluateConditions>[] = [];
  let outcome: Route = { type: 'SERVICE_DEFAULT' };
  let matchedRule: { id: string; name: string } | null = null;
  const supplementalActions: SupplementalAction[] = [];
  for (const [ruleIndex, rule] of version.rules.entries()) {
    if (!rule.enabled || rule.phase !== 'ROUTE') continue;
    guard({ phase: 'ROUTING', ruleIndex, conditionIndex: null });
    const result = evaluateConditions(context, rule, conditionIndex =>
      guard({ phase: 'ROUTING', ruleIndex, conditionIndex })
    );
    results.push(result);
    if (result.result !== 'TRUE') continue;
    matchedRule = { id: rule.id, name: rule.name };
    const routes = rule.actions.filter(a =>
      ['USE_SERVICE_DEFAULT', 'USE_ESCALATION_POLICY', 'NO_ESCALATION'].includes(a.type)
    );
    if (routes.length !== 1) throw new Error('VERSION_INVALID');
    for (const [actionIndex, action] of rule.actions.entries()) {
      const position = { phase: 'ROUTING' as const, ruleIndex, conditionIndex: null, actionIndex };
      guard(position);
      if (action.type === 'USE_ESCALATION_POLICY')
        outcome = { type: 'ESCALATION_POLICY', policyId: action.policyId };
      else if (action.type === 'NO_ESCALATION') outcome = { type: 'NO_ESCALATION' };
      else if (action.type === 'NOTIFY_CHANNEL') {
        if (
          !supplementalActions.some(
            existing =>
              existing.provider === action.provider &&
              existing.destinationId === action.destinationId
          )
        )
          supplementalActions.push({ ...action, ruleId: rule.id });
      } else if (action.type !== 'USE_SERVICE_DEFAULT') throw new Error('VERSION_INVALID');
      guard(position);
    }
    break;
  }
  return { results, outcome, matchedRule, supplementalActions };
}
