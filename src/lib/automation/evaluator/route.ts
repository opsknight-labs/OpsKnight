import type { CompiledSnapshot, Context, Route, SupplementalAction } from '../contract';
import { evaluateConditions } from './conditions';
export function evaluateRouting(version: CompiledSnapshot, context: Context, guard: () => void) {
  const results: ReturnType<typeof evaluateConditions>[] = [];
  let outcome: Route = { type: 'SERVICE_DEFAULT' };
  let matchedRule: { id: string; name: string } | null = null;
  const supplementalActions: SupplementalAction[] = [];
  for (const rule of version.rules.filter(r => r.enabled && r.phase === 'ROUTE')) {
    guard();
    const result = evaluateConditions(context, rule);
    results.push(result);
    if (result.result !== 'TRUE') continue;
    matchedRule = { id: rule.id, name: rule.name };
    const routes = rule.actions.filter(a =>
      ['USE_SERVICE_DEFAULT', 'USE_ESCALATION_POLICY', 'NO_ESCALATION'].includes(a.type)
    );
    if (routes.length !== 1) throw new Error('VERSION_INVALID');
    for (const action of rule.actions) {
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
    }
    break;
  }
  return { results, outcome, matchedRule, supplementalActions };
}
