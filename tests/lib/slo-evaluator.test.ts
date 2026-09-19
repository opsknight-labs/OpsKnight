import { describe, expect, it } from 'vitest';
import { objectiveIsCompliant, objectiveWindowDays } from '@/lib/slo/evaluator';

describe('service objective evaluator semantics', () => {
  it('uses explicit comparison direction and treats equality as compliant', () => {
    expect(objectiveIsCompliant(99.9, 99.9, 'GREATER_THAN_OR_EQUAL')).toBe(true);
    expect(objectiveIsCompliant(99.8, 99.9, 'GREATER_THAN_OR_EQUAL')).toBe(false);
    expect(objectiveIsCompliant(30, 30, 'LESS_THAN_OR_EQUAL')).toBe(true);
    expect(objectiveIsCompliant(31, 30, 'LESS_THAN_OR_EQUAL')).toBe(false);
    expect(objectiveIsCompliant(null, 30, 'LESS_THAN_OR_EQUAL')).toBeNull();
  });

  it('maps named and rolling windows deterministically', () => {
    expect(objectiveWindowDays('SEVEN_DAYS', null)).toBe(7);
    expect(objectiveWindowDays('QUARTERLY', null)).toBe(90);
    expect(objectiveWindowDays('ROLLING_DAYS', 42)).toBe(42);
  });
});
