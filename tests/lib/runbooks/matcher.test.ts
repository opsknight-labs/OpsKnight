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

  it('never satisfies negative comparisons when the target field is missing or null', () => {
    expect(
      matchesCondition(context, {
        field: 'incident.environment',
        operator: 'NOT_EQUALS',
        value: 'production',
      })
    ).toBe(false);
    expect(
      matchesCondition(context, {
        field: 'incident.priority',
        operator: 'NOT_IN',
        value: ['P1', 'P2'],
      })
    ).toBe(false);
    expect(
      matchesCondition(context, {
        field: 'incident.missingField',
        operator: 'EQUALS',
        value: 'test',
      })
    ).toBe(false);
    expect(
      matchesCondition(context, {
        field: 'incident.environment',
        operator: 'NOT_EXISTS',
        value: null,
      })
    ).toBe(true);
    expect(
      matchesCondition(context, {
        field: 'incident.environment',
        operator: 'EXISTS',
        value: null,
      })
    ).toBe(false);
    expect(
      matchesCondition(context, {
        field: 'incident.urgency',
        operator: 'NOT_EQUALS',
        value: 'LOW',
      })
    ).toBe(true);
    expect(
      matchesCondition(context, {
        field: 'incident.urgency',
        operator: 'NOT_IN',
        value: ['LOW', 'MEDIUM'],
      })
    ).toBe(true);
  });

  it('matches typed NUMBER and BOOLEAN values with string representations across operators', () => {
    const typedContext = {
      inputs: {
        replicas: 4,
        threshold: '4',
        enabled: true,
        maintenance: false,
        flagStr: 'true',
      },
    };

    // NUMBER comparison (number vs string representation)
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.replicas',
        operator: 'EQUALS',
        value: '4',
      })
    ).toBe(true);
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.threshold',
        operator: 'EQUALS',
        value: 4,
      })
    ).toBe(true);
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.replicas',
        operator: 'NOT_EQUALS',
        value: '5',
      })
    ).toBe(true);
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.replicas',
        operator: 'IN',
        value: ['3', '4', '5'],
      })
    ).toBe(true);
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.replicas',
        operator: 'IN',
        value: [1, 2, 3],
      })
    ).toBe(false);
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.replicas',
        operator: 'NOT_IN',
        value: ['1', '2', '3'],
      })
    ).toBe(true);

    // BOOLEAN comparison (boolean vs string representation)
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.enabled',
        operator: 'EQUALS',
        value: 'true',
      })
    ).toBe(true);
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.flagStr',
        operator: 'EQUALS',
        value: true,
      })
    ).toBe(true);
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.maintenance',
        operator: 'EQUALS',
        value: 'false',
      })
    ).toBe(true);
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.maintenance',
        operator: 'NOT_EQUALS',
        value: 'true',
      })
    ).toBe(true);
    expect(
      matchesCondition(typedContext, {
        field: 'inputs.enabled',
        operator: 'IN',
        value: ['true', 'false'],
      })
    ).toBe(true);
  });

  it('preserves strict equality for non-typed incident and service fields without type coercion', () => {
    const triggerContext = {
      incident: { id: '001', code: '042', priority: '1', active: 'true' },
      service: { id: 100, teamId: '200' },
    };

    // Incident fields must NOT coerce numeric strings or booleans
    expect(
      matchesCondition(triggerContext, {
        field: 'incident.id',
        operator: 'EQUALS',
        value: 1,
      })
    ).toBe(false);
    expect(
      matchesCondition(triggerContext, {
        field: 'incident.id',
        operator: 'EQUALS',
        value: '001',
      })
    ).toBe(true);
    expect(
      matchesCondition(triggerContext, {
        field: 'incident.priority',
        operator: 'EQUALS',
        value: 1,
      })
    ).toBe(false);
    expect(
      matchesCondition(triggerContext, {
        field: 'incident.active',
        operator: 'EQUALS',
        value: true,
      })
    ).toBe(false);
    expect(
      matchesCondition(triggerContext, {
        field: 'incident.id',
        operator: 'IN',
        value: [1, 2, 3],
      })
    ).toBe(false);
    expect(
      matchesCondition(triggerContext, {
        field: 'incident.id',
        operator: 'IN',
        value: ['001', '002'],
      })
    ).toBe(true);

    // Service fields must NOT coerce numeric strings
    expect(
      matchesCondition(triggerContext, {
        field: 'service.id',
        operator: 'EQUALS',
        value: '100',
      })
    ).toBe(false);
    expect(
      matchesCondition(triggerContext, {
        field: 'service.teamId',
        operator: 'EQUALS',
        value: 200,
      })
    ).toBe(false);

    // Trigger matcher enforces strict matching across AND/OR logic
    expect(
      matchesTrigger(
        triggerContext,
        [{ field: 'incident.id', operator: 'EQUALS', value: 1 }],
        'AND'
      )
    ).toBe(false);
    expect(
      matchesTrigger(
        triggerContext,
        [{ field: 'incident.id', operator: 'EQUALS', value: '001' }],
        'AND'
      )
    ).toBe(true);
  });

  it('rejects number coercion for numeric strings with leading zeros even in typed input fields', () => {
    const leadingZeroContext = {
      inputs: {
        zipCode: '001',
        leadZero: '042',
        exactZero: '0',
        standardNum: '42',
        numericVal: 1,
      },
    };

    // Strings with leading zeros must not coerce to numbers
    expect(
      matchesCondition(leadingZeroContext, {
        field: 'inputs.zipCode',
        operator: 'EQUALS',
        value: 1,
      })
    ).toBe(false);
    expect(
      matchesCondition(leadingZeroContext, {
        field: 'inputs.numericVal',
        operator: 'EQUALS',
        value: '001',
      })
    ).toBe(false);
    expect(
      matchesCondition(leadingZeroContext, {
        field: 'inputs.leadZero',
        operator: 'EQUALS',
        value: 42,
      })
    ).toBe(false);

    // Exact string match still succeeds
    expect(
      matchesCondition(leadingZeroContext, {
        field: 'inputs.zipCode',
        operator: 'EQUALS',
        value: '001',
      })
    ).toBe(true);

    // Standard numbers without leading zeros still coerce properly
    expect(
      matchesCondition(leadingZeroContext, {
        field: 'inputs.standardNum',
        operator: 'EQUALS',
        value: 42,
      })
    ).toBe(true);
    expect(
      matchesCondition(leadingZeroContext, {
        field: 'inputs.exactZero',
        operator: 'EQUALS',
        value: 0,
      })
    ).toBe(true);
  });
});
