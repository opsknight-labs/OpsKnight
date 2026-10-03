import { describe, expect, it } from 'vitest';
import { matchesCondition, matchesTrigger } from '@/lib/runbooks/matcher';

describe('runbook trigger matcher', () => {
  const context = {
    incident: { urgency: 'HIGH', title: 'Database latency', tags: ['production', 'database'] },
    service: { name: 'Payments API' },
  };

  it('matches typed nested fields without evaluating arbitrary expressions', () => {
    expect(
      matchesCondition(context, { field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH' })
    ).toBe(true);
    expect(
      matchesCondition(context, { field: 'incident.title', operator: 'CONTAINS', value: 'latency' })
    ).toBe(true);
    expect(
      matchesCondition(context, {
        field: 'incident.tags',
        operator: 'CONTAINS',
        value: 'production',
      })
    ).toBe(true);
  });

  it('supports AND and OR condition logic', () => {
    const conditions = [
      { field: 'incident.urgency', operator: 'EQUALS' as const, value: 'HIGH' },
      { field: 'service.name', operator: 'EQUALS' as const, value: 'Orders API' },
    ];
    expect(matchesTrigger(context, conditions, 'AND')).toBe(false);
    expect(matchesTrigger(context, conditions, 'OR')).toBe(true);
  });

  it('does not traverse prototypes', () => {
    expect(
      matchesCondition(context, { field: '__proto__.constructor', operator: 'EXISTS', value: null })
    ).toBe(false);
  });
});
