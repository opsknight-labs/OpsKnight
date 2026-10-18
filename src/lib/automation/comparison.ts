import type { Route } from './contract';

/** Compare effective routing, preserving intentional suppression as a distinct
 * decision even when the service currently has no default escalation policy.
 */
export function compareAutomationOutcomes(input: {
  actual: Route;
  hypothetical: Route;
  defaultPolicyId: string | null;
  actualPolicyId: string | null;
  actualPriority: string | null;
  hypotheticalPriority: string | null;
}) {
  const suppressed = input.actual.type === 'NO_ESCALATION';
  const wouldSuppress = input.hypothetical.type === 'NO_ESCALATION';
  const noEscalationDifferent = suppressed !== wouldSuppress;
  const hypotheticalPolicyId =
    input.hypothetical.type === 'ESCALATION_POLICY'
      ? input.hypothetical.policyId
      : input.defaultPolicyId;
  const routeDifferent =
    noEscalationDifferent ||
    (!suppressed && !wouldSuppress && hypotheticalPolicyId !== input.actualPolicyId);
  const priorityDifferent = input.hypotheticalPriority !== input.actualPriority;
  return {
    routeDifferent,
    priorityDifferent,
    noEscalationDifferent,
    same: !routeDifferent && !priorityDifferent,
  };
}
