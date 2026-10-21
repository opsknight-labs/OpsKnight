import { describe, expect, it } from 'vitest';
import { compareAutomationOutcomes } from '@/lib/automation/comparison';
import type { Route } from '@/lib/automation/contract';
const compare = (actual: Route, hypothetical: Route, actualPolicyId: string | null = null) =>
  compareAutomationOutcomes({
    actual,
    hypothetical,
    actualPolicyId,
    defaultPolicyId: null,
    actualPriority: 'P1',
    hypotheticalPriority: 'P1',
  });
describe('candidate routing difference semantics', () => {
  it('counts unchanged suppression as the same outcome', () => {
    expect(compare({ type: 'NO_ESCALATION' }, { type: 'NO_ESCALATION' })).toEqual({
      same: true,
      routeDifferent: false,
      priorityDifferent: false,
      noEscalationDifferent: false,
    });
  });
  it.each([
    [{ type: 'SERVICE_DEFAULT' }, { type: 'NO_ESCALATION' }],
    [{ type: 'NO_ESCALATION' }, { type: 'SERVICE_DEFAULT' }],
    [{ type: 'NO_ESCALATION' }, { type: 'ESCALATION_POLICY', policyId: 'policy' }],
  ] satisfies [Route, Route][])(
    'counts suppression introduced or removed even without a default policy',
    (actual, hypothetical) => {
      expect(compare(actual, hypothetical)).toMatchObject({
        same: false,
        routeDifferent: true,
        noEscalationDifferent: true,
      });
    }
  );
  it('distinguishes policy changes from suppression changes', () => {
    expect(
      compare(
        { type: 'ESCALATION_POLICY', policyId: 'old' },
        { type: 'ESCALATION_POLICY', policyId: 'new' },
        'old'
      )
    ).toMatchObject({ routeDifferent: true, noEscalationDifferent: false });
  });
  it('treats explicit and service-default selection of the same policy as equivalent', () => {
    expect(
      compareAutomationOutcomes({
        actual: { type: 'ESCALATION_POLICY', policyId: 'policy' },
        hypothetical: { type: 'SERVICE_DEFAULT' },
        defaultPolicyId: 'policy',
        actualPolicyId: 'policy',
        actualPriority: 'P1',
        hypotheticalPriority: 'P1',
      })
    ).toMatchObject({ same: true, routeDifferent: false });
  });
  it('counts priority changes independently from unchanged suppression', () => {
    expect(
      compareAutomationOutcomes({
        actual: { type: 'NO_ESCALATION' },
        hypothetical: { type: 'NO_ESCALATION' },
        defaultPolicyId: null,
        actualPolicyId: null,
        actualPriority: 'P1',
        hypotheticalPriority: 'P3',
      })
    ).toMatchObject({
      same: false,
      priorityDifferent: true,
      routeDifferent: false,
      noEscalationDifferent: false,
    });
  });
});
