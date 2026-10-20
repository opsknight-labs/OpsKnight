import { goldenResults } from '@/lib/automation/golden';
import { describe, it, expect, vi } from 'vitest';
import fixtures from '../fixtures/automation/operators.json';
import {
  conditionSchema,
  type FieldState,
  type Snapshot,
  builtinFields,
} from '@/lib/automation/contract';
import { evaluateOperator } from '@/lib/automation/evaluator/operators';
import { normalizeValue } from '@/lib/automation/context/normalize';
import { compileAutomation } from '@/lib/automation/compiler';
import { evaluateAutomation } from '@/lib/automation/evaluator';
import { compilePath, readCompiledPath } from '@/lib/automation/context/extract';
import { discoverFields } from '@/lib/automation/discovery';
import { jobSchema } from '@/lib/automation/jobs';
describe('automation semantics', () => {
  for (const result of goldenResults())
    it(`golden pipeline: ${result.name}`, () => expect(result.actual).toBe(result.expected));
  for (const fixture of fixtures)
    it(fixture.name, () =>
      expect(
        evaluateOperator(fixture.field as FieldState, conditionSchema.parse(fixture.condition))
      ).toBe(fixture.expected)
    );
  it('preserves falsy scalars and missing strings', () => {
    const number = { ...builtinFields[0], type: 'NUMBER' as const };
    expect(normalizeValue(0, number)).toEqual({ state: 'RECOGNIZED', value: 0 });
    expect(normalizeValue('invalid', number).state).toBe('UNMAPPED');
    expect(normalizeValue(false, { ...number, type: 'BOOLEAN' })).toEqual({
      state: 'RECOGNIZED',
      value: false,
    });
    for (const missing of ['', '  ', null, undefined])
      expect(normalizeValue(missing, number).state).toBe('MISSING');
  });
  it('enforces byte limits for Unicode, escaped scalars and consecutive shorter values', () => {
    const field = { ...builtinFields[0], type: 'STRING' as const };
    for (const raw of [
      'x'.repeat(2048),
      'é'.repeat(1024),
      '😀'.repeat(512),
      '\ud800'.repeat(682),
    ]) {
      expect(normalizeValue(raw, field).state).toBe('RECOGNIZED');
      expect(() => normalizeValue(`${raw}😀`, field)).toThrow('EXTRACTION_LIMIT');
      expect(normalizeValue('short', field)).toEqual({ state: 'RECOGNIZED', value: 'short' });
    }
    expect(() => normalizeValue('x'.repeat(100000), field)).toThrow('EXTRACTION_LIMIT');
    const enumField = { ...field, type: 'ENUM' as const, allowedValues: ['é'.repeat(128)] };
    expect(normalizeValue('é'.repeat(128), enumField).state).toBe('RECOGNIZED');
    expect(() => normalizeValue('é'.repeat(129), enumField)).toThrow('EXTRACTION_LIMIT');
  });

  it('blocks unsafe paths', () => {
    for (const path of ['a.__proto__.b', '$.Authorization', 'a.token', '$.a[*]', 'a..b'])
      expect(() => compilePath(path)).toThrow();
  });
  it('supports root array bracket paths and rejects bare numeric paths', () => {
    const tokens = compilePath('[0].name');
    expect(readCompiledPath([{ name: 'test-service' }], tokens)).toBe('test-service');
    const tokensDollar = compilePath('$[1].id');
    expect(readCompiledPath([{ id: 'a' }, { id: 'b' }], tokensDollar)).toBe('b');
    expect(() => compilePath('0.name')).toThrow(/bracket notation/);
  });
  it('suppresses priority conflict warnings when rules are mutually exclusive and honors displayOnly', () => {
    const fields = [
      {
        fieldId: 'env',
        key: 'environment',
        label: 'Environment',
        type: 'ENUM' as const,
        allowedValues: ['production', 'staging'],
        aliases: {},
        mappings: [],
      },
      {
        fieldId: 'audit',
        key: 'audit_log',
        label: 'Audit Log',
        type: 'STRING' as const,
        displayOnly: true,
        mappings: [],
      },
    ];

    // Mutually exclusive rules writing priority: environment == production vs environment == staging
    const exclusiveResult = compileAutomation({
      schemaVersion: 1,
      fields,
      rules: [
        {
          id: 'prod-rule',
          name: 'Prod Priority',
          phase: 'ENRICH',
          enabled: true,
          conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'production' }],
          actions: [{ type: 'SET_PRIORITY', value: 'P1' }],
        },
        {
          id: 'staging-rule',
          name: 'Staging Priority',
          phase: 'ENRICH',
          enabled: true,
          conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'staging' }],
          actions: [{ type: 'SET_PRIORITY', value: 'P2' }],
        },
      ],
    });
    expect(exclusiveResult.issues.filter(i => i.code === 'PRIORITY_CONFLICT')).toHaveLength(0);
    expect(
      exclusiveResult.issues.filter(
        i => i.code === 'UNUSED_FIELD' && i.message.includes('audit_log')
      )
    ).toHaveLength(0);

    // Overlapping rules writing priority: no conditions (catch-all) or non-exclusive conditions
    const overlappingResult = compileAutomation({
      schemaVersion: 1,
      fields,
      rules: [
        {
          id: 'rule-1',
          name: 'Rule 1',
          phase: 'ENRICH',
          enabled: true,
          conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'production' }],
          actions: [{ type: 'SET_PRIORITY', value: 'P1' }],
        },
        {
          id: 'rule-2',
          name: 'Rule 2',
          phase: 'ENRICH',
          enabled: true,
          conditions: [],
          actions: [{ type: 'SET_PRIORITY', value: 'P2' }],
        },
      ],
    });
    expect(overlappingResult.issues.filter(i => i.code === 'PRIORITY_CONFLICT')).toHaveLength(1);
  });

  it('validates observation-job payload contract and rejects extra properties', () => {
    const discovered = discoverFields({
      repository: { name: 'opsknight', active: true, stars: 100 },
    });
    expect(discovered.length).toBeGreaterThan(0);
    for (const item of discovered) {
      expect(item).not.toHaveProperty('label');
      expect(item).not.toHaveProperty('source');
      expect(item).not.toHaveProperty('integrationType');
    }

    const validPayload = {
      task: 'AUTOMATION_OBSERVE',
      logicalKey: 'AUTOMATION_OBSERVE:inc-123',
      serviceId: 'srv-1',
      integrationId: 'int-1',
      integrationType: 'GITHUB',
      observations: discovered,
    };
    expect(jobSchema.safeParse(validPayload).success).toBe(true);

    // Unrecognized key 'label' must fail strict job schema validation
    const invalidPayload = {
      ...validPayload,
      observations: discovered.map(o => ({ ...o, label: 'Invalid Label' })),
    };
    expect(jobSchema.safeParse(invalidPayload).success).toBe(false);
  });
  it('preserves fail-safe semantics where missing or unmapped values evaluate to UNKNOWN for NE and NOT_IN', () => {
    const missingState: FieldState = { state: 'MISSING' };
    const unmappedState: FieldState = { state: 'UNMAPPED', raw: 'other' };

    expect(
      evaluateOperator(missingState, {
        fieldKey: 'environment',
        operator: 'NE',
        value: 'production',
      })
    ).toBe('UNKNOWN');
    expect(
      evaluateOperator(unmappedState, {
        fieldKey: 'environment',
        operator: 'NOT_IN',
        value: ['production', 'staging'],
      })
    ).toBe('UNKNOWN');
  });
  it('detects alias collisions', () => {
    const result = compileAutomation({
      schemaVersion: 1,
      fields: [
        {
          fieldId: 'env',
          key: 'environment',
          label: 'Environment',
          type: 'ENUM',
          allowedValues: ['production', 'prod'],
          aliases: { Prod: 'production', PROD: 'prod' },
          mappings: [],
        },
      ],
      rules: [],
    });
    expect(result.issues.some(i => i.code === 'ALIAS_COLLISION')).toBe(true);
  });
  it('preserves declared ENUM display values across case-insensitive inputs and aliases', () => {
    const { compiled, issues } = compileAutomation({
      schemaVersion: 1,
      fields: [
        {
          fieldId: 'env',
          key: 'environment',
          label: 'Environment',
          type: 'ENUM',
          allowedValues: ['Production', 'Staging'],
          aliases: { prod: 'Production' },
          mappings: [],
        },
      ],
      rules: [
        {
          id: 'production',
          name: 'Production',
          phase: 'ROUTE',
          enabled: true,
          conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'Production' }],
          actions: [{ type: 'USE_SERVICE_DEFAULT' }],
        },
      ],
    });
    expect(issues.filter(issue => issue.level === 'ERROR')).toEqual([]);
    for (const input of ['Production', 'production', 'PRODUCTION', ' prod '])
      expect(normalizeValue(input, compiled.fields[0])).toEqual({
        state: 'RECOGNIZED',
        value: 'Production',
      });
  });
  it('rejects normalized ENUM collisions while allowing distinct case-sensitive choices', () => {
    const snapshot = {
      schemaVersion: 1,
      fields: [
        {
          fieldId: 'env',
          key: 'environment',
          label: 'Environment',
          type: 'ENUM',
          allowedValues: ['Prod', 'prod', 'PROD'],
          aliases: {},
          mappings: [],
        },
      ],
      rules: [],
    };
    expect(compileAutomation(snapshot).issues.some(issue => issue.code === 'ENUM_COLLISION')).toBe(
      true
    );
    snapshot.fields[0] = {
      ...snapshot.fields[0],
      caseSensitive: true,
    } as (typeof snapshot.fields)[0];
    expect(compileAutomation(snapshot).issues.some(issue => issue.code === 'ENUM_COLLISION')).toBe(
      false
    );
  });
  it('routes post enrichment, unions tags, replays identically', () => {
    const snapshot: Snapshot = {
      schemaVersion: 1,
      fields: [],
      rules: [
        {
          id: 'first',
          name: 'First',
          phase: 'ENRICH',
          enabled: true,
          conditions: [],
          actions: [
            { type: 'SET_PRIORITY', value: 'P2' },
            { type: 'ADD_TAG', value: 'vip' },
          ],
        },
        {
          id: 'second',
          name: 'Second',
          phase: 'ENRICH',
          enabled: true,
          conditions: [{ fieldKey: 'priority', operator: 'EQ', value: 'P2' }],
          actions: [
            { type: 'SET_PRIORITY', value: 'P1' },
            { type: 'ADD_TAG', value: 'vip' },
          ],
        },
        {
          id: 'route',
          name: 'Route',
          phase: 'ROUTE',
          enabled: true,
          conditions: [{ fieldKey: 'priority', operator: 'EQ', value: 'P1' }],
          actions: [{ type: 'USE_ESCALATION_POLICY', policyId: 'policy-b' }],
        },
      ],
    };
    const input = {
      version: compileAutomation(snapshot).compiled,
      initialContext: {},
      evaluationAt: '2026-10-07T00:00:00Z',
    };
    const result = evaluateAutomation(input);
    expect(result.outcome).toEqual({ type: 'ESCALATION_POLICY', policyId: 'policy-b' });
    expect(result.tags).toEqual(['vip']);
    expect(result.enrichedContext.priority).toEqual({ state: 'RECOGNIZED', value: 'P1' });
    expect(evaluateAutomation(input)).toEqual(result);
  });
  it('never invents a route for randomized contexts', () => {
    for (let n = 0; n < 100; n++) {
      const version = compileAutomation({
        schemaVersion: 1,
        fields: [],
        rules: [
          {
            id: 'route',
            name: 'Route',
            phase: 'ROUTE',
            conditions: [{ fieldKey: 'priority', operator: 'EQ', value: 'P1' }],
            actions: [{ type: 'NO_ESCALATION' }],
          },
        ],
      }).compiled;
      const result = evaluateAutomation({
        version,
        initialContext: { priority: { state: 'RECOGNIZED', value: `P${1 + (n % 5)}` } },
        evaluationAt: '2026-10-07T00:00:00Z',
      });
      expect(['NO_ESCALATION', 'SERVICE_DEFAULT']).toContain(result.outcome.type);
    }
  });
  it('does not treat nullable priority as a catch all', () => {
    expect(
      compileAutomation({
        schemaVersion: 1,
        fields: [],
        rules: [
          {
            id: 'none',
            name: 'None',
            phase: 'ROUTE',
            conditions: [{ fieldKey: 'priority', operator: 'IS_SET' }],
            actions: [{ type: 'NO_ESCALATION' }],
          },
        ],
      }).issues
    ).toEqual([]);
  });
});

it('deduplicates identical supplemental destinations within the selected route', () => {
  const { compiled } = compileAutomation({
    schemaVersion: 1,
    fields: [],
    rules: [
      {
        id: 'channels',
        name: 'Channels',
        phase: 'ROUTE',
        conditions: [],
        actions: [
          { type: 'USE_SERVICE_DEFAULT' },
          { type: 'NOTIFY_CHANNEL', provider: 'SLACK', destinationId: 'one' },
          { type: 'NOTIFY_CHANNEL', provider: 'SLACK', destinationId: 'one' },
        ],
      },
    ],
  });
  expect(
    evaluateAutomation({
      version: compiled,
      initialContext: {},
      evaluationAt: '2026-10-07T00:00:00Z',
    }).supplementalActions
  ).toHaveLength(1);
});

it('reports phase and numeric positions to the deadline guard without sensitive rule values', () => {
  const snapshot: Snapshot = {
    schemaVersion: 1,
    fields: [],
    rules: [
      {
        id: 'private-rule-id',
        name: 'private-name',
        phase: 'ROUTE',
        enabled: true,
        conditions: [{ fieldKey: 'priority', operator: 'EQ', value: 'P1' }],
        actions: [{ type: 'NO_ESCALATION' }],
      },
    ],
  };
  const version = compileAutomation(snapshot).compiled;
  const guard = vi.fn();
  evaluateAutomation({
    version,
    initialContext: { priority: { state: 'RECOGNIZED', value: 'P1' } },
    evaluationAt: '2026-10-12T00:00:00Z',
    guard,
  });
  expect(guard).toHaveBeenCalledWith({
    phase: 'ENRICHMENT',
    ruleIndex: null,
    conditionIndex: null,
  });
  expect(guard).toHaveBeenCalledWith({ phase: 'ROUTING', ruleIndex: 0, conditionIndex: 0 });
  expect(guard).toHaveBeenCalledWith({
    phase: 'ROUTING',
    ruleIndex: 0,
    conditionIndex: null,
    actionIndex: 0,
  });
  expect(JSON.stringify(guard.mock.calls)).not.toContain('private');
  expect(() =>
    evaluateAutomation({
      version,
      initialContext: {},
      evaluationAt: '2026-10-12T00:00:00Z',
      guard: position => {
        if (position?.conditionIndex === 0) throw new Error('EVALUATION_TIMEOUT');
      },
    })
  ).toThrow('EVALUATION_TIMEOUT');
});
