import { describe, expect, it, vi } from 'vitest';
import { matchesCondition, matchesTrigger, validateAndMatchTrigger } from '@/lib/runbooks/matcher';

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

  it.each([
    ['42', true],
    ['4.2e1', true],
    [' 42 ', true],
    ['042', false],
    ['+42', false],
    ['0x2a', false],
    ['42.', false],
    ['[42]', false],
    ['"42"', false],
    ['null', false],
  ])('checks numeric grammar for %s without regex backtracking', (value, expected) => {
    expect(
      matchesCondition(
        { input: { count: 42 } },
        { field: 'input.count', operator: 'EQUALS', value },
        new Map([['count', 'NUMBER']])
      )
    ).toBe(expected);
  });

  it('does not invoke accessor properties while resolving a condition path', () => {
    const getter = vi.fn(() => 42);
    const input = Object.defineProperty({}, 'count', { get: getter, enumerable: true });
    expect(
      matchesCondition({ input }, { field: 'input.count', operator: 'EXISTS', value: null })
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
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

  it('requires string comparison values for CONTAINS and STARTS_WITH on non-input incident and service fields', () => {
    const stringContext = {
      incident: {
        title: '503 Service Unavailable in production',
        tags: ['production', '503', 'payments'],
      },
      service: {
        name: '404 handler',
      },
    };

    // Incident title contains/starts_with: numeric value 503 must NOT match
    expect(
      matchesCondition(stringContext, {
        field: 'incident.title',
        operator: 'CONTAINS',
        value: 503,
      })
    ).toBe(false);
    expect(
      matchesCondition(stringContext, {
        field: 'incident.title',
        operator: 'STARTS_WITH',
        value: 503,
      })
    ).toBe(false);

    // Incident title contains/starts_with: string value '503' DOES match
    expect(
      matchesCondition(stringContext, {
        field: 'incident.title',
        operator: 'CONTAINS',
        value: '503',
      })
    ).toBe(true);
    expect(
      matchesCondition(stringContext, {
        field: 'incident.title',
        operator: 'STARTS_WITH',
        value: '503',
      })
    ).toBe(true);

    // Incident tags contains: numeric value 503 must NOT match
    expect(
      matchesCondition(stringContext, {
        field: 'incident.tags',
        operator: 'CONTAINS',
        value: 503,
      })
    ).toBe(false);
    expect(
      matchesCondition(stringContext, {
        field: 'incident.tags',
        operator: 'CONTAINS',
        value: '503',
      })
    ).toBe(true);

    // Service name: numeric value 404 must NOT match
    expect(
      matchesCondition(stringContext, {
        field: 'service.name',
        operator: 'STARTS_WITH',
        value: 404,
      })
    ).toBe(false);
    expect(
      matchesCondition(stringContext, {
        field: 'service.name',
        operator: 'STARTS_WITH',
        value: '404',
      })
    ).toBe(true);
  });

  it('disallows numeric coercion on typed inputs when declared type is STRING', () => {
    const inputContext = {
      input: {
        releaseVersion: '12',
        serverCount: '12',
      },
    };

    const declaredTypes = {
      releaseVersion: 'STRING',
      serverCount: 'NUMBER',
    };

    // releaseVersion is declared STRING: numeric 12 must NOT match
    expect(
      matchesCondition(
        inputContext,
        { field: 'input.releaseVersion', operator: 'EQUALS', value: 12 },
        declaredTypes
      )
    ).toBe(false);
    expect(
      matchesCondition(
        inputContext,
        { field: 'input.releaseVersion', operator: 'NOT_EQUALS', value: 12 },
        declaredTypes
      )
    ).toBe(true);
    expect(
      matchesCondition(
        inputContext,
        { field: 'input.releaseVersion', operator: 'IN', value: [11, 12, 13] },
        declaredTypes
      )
    ).toBe(false);
    expect(
      matchesCondition(
        inputContext,
        { field: 'input.releaseVersion', operator: 'CONTAINS', value: 12 },
        declaredTypes
      )
    ).toBe(false);
    expect(
      matchesCondition(
        inputContext,
        { field: 'input.releaseVersion', operator: 'STARTS_WITH', value: 12 },
        declaredTypes
      )
    ).toBe(false);

    // releaseVersion exact string '12' DOES match
    expect(
      matchesCondition(
        inputContext,
        { field: 'input.releaseVersion', operator: 'EQUALS', value: '12' },
        declaredTypes
      )
    ).toBe(true);
    expect(
      matchesCondition(
        inputContext,
        { field: 'input.releaseVersion', operator: 'IN', value: ['11', '12', '13'] },
        declaredTypes
      )
    ).toBe(true);

    // serverCount is declared NUMBER: numeric coercion is allowed
    expect(
      matchesCondition(
        inputContext,
        { field: 'input.serverCount', operator: 'EQUALS', value: 12 },
        declaredTypes
      )
    ).toBe(true);

    // Works with Map input types
    const typeMap = new Map<string, string>([
      ['releaseVersion', 'STRING'],
      ['serverCount', 'NUMBER'],
    ]);
    expect(
      matchesCondition(
        inputContext,
        { field: 'input.releaseVersion', operator: 'EQUALS', value: 12 },
        typeMap
      )
    ).toBe(false);

    // Works with context.__inputTypes
    const contextWithTypes = {
      ...inputContext,
      __inputTypes: declaredTypes,
    };
    expect(
      matchesCondition(contextWithTypes, {
        field: 'input.releaseVersion',
        operator: 'EQUALS',
        value: 12,
      })
    ).toBe(false);

    // Works with matchesTrigger
    expect(
      matchesTrigger(
        inputContext,
        [{ field: 'input.releaseVersion', operator: 'EQUALS', value: 12 }],
        'AND',
        declaredTypes
      )
    ).toBe(false);
  });
});

it('validates all stored OR conditions before allowing a matching branch', () => {
  const context = { incident: { urgency: 'HIGH' } };
  const matching = { field: 'incident.urgency', operator: 'EQUALS' as const, value: 'HIGH' };
  expect(validateAndMatchTrigger(context, [matching], 'OR')).toBe(true);
  expect(() =>
    validateAndMatchTrigger(
      context,
      [
        matching,
        {
          field: 'incident.severityTYPO',
          operator: 'NOT_EXISTS',
          value: null,
        },
      ],
      'OR'
    )
  ).toThrow('unsupported condition');
});
