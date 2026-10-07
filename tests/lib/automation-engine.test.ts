import { describe, it, expect } from 'vitest';
import fixtures from '../fixtures/automation/operators.json';
import { conditionSchema, type FieldState, type Snapshot, builtinFields } from '@/lib/automation/contract';
import { evaluateOperator } from '@/lib/automation/evaluator/operators';
import { normalizeValue } from '@/lib/automation/context/normalize';
import { compileAutomation } from '@/lib/automation/compiler';
import { evaluateAutomation } from '@/lib/automation/evaluator';
import { compilePath } from '@/lib/automation/context/extract';
describe('automation semantics', () => {
  for (const fixture of fixtures) it(fixture.name, () => expect(evaluateOperator(fixture.field as FieldState, conditionSchema.parse(fixture.condition))).toBe(fixture.expected));
  it('preserves falsy scalars and missing strings', () => {
    const number = { ...builtinFields[0], type: 'NUMBER' as const };
    expect(normalizeValue(0, number)).toEqual({ state: 'RECOGNIZED', value: 0 });
    expect(normalizeValue('invalid', number).state).toBe('UNMAPPED');
    expect(normalizeValue(false, { ...number, type: 'BOOLEAN' })).toEqual({ state: 'RECOGNIZED', value: false });
    for (const missing of ['', '  ', null, undefined]) expect(normalizeValue(missing, number).state).toBe('MISSING');
  });
  it('blocks unsafe paths', () => { for (const path of ['a.__proto__.b', '$.Authorization', 'a.token', '$.a[*]', 'a..b']) expect(() => compilePath(path)).toThrow(); });
  it('detects alias collisions', () => {
    const result = compileAutomation({ schemaVersion: 1, fields: [{ fieldId: 'env', key: 'environment', label: 'Environment', type: 'ENUM', allowedValues: ['production', 'prod'], aliases: { Prod: 'production', PROD: 'prod' }, mappings: [] }], rules: [] });
    expect(result.issues.some(i => i.code === 'ALIAS_COLLISION')).toBe(true);
  });
  it('routes post enrichment, unions tags, replays identically', () => {
    const snapshot: Snapshot = { schemaVersion: 1, fields: [], rules: [
      { id: 'first', name: 'First', phase: 'ENRICH', enabled: true, conditions: [], actions: [{ type: 'SET_PRIORITY', value: 'P2' }, { type: 'ADD_TAG', value: 'vip' }] },
      { id: 'second', name: 'Second', phase: 'ENRICH', enabled: true, conditions: [{ fieldKey: 'priority', operator: 'EQ', value: 'P2' }], actions: [{ type: 'SET_PRIORITY', value: 'P1' }, { type: 'ADD_TAG', value: 'vip' }] },
      { id: 'route', name: 'Route', phase: 'ROUTE', enabled: true, conditions: [{ fieldKey: 'priority', operator: 'EQ', value: 'P1' }], actions: [{ type: 'USE_ESCALATION_POLICY', policyId: 'policy-b' }] },
    ] };
    const input = { version: compileAutomation(snapshot).compiled, initialContext: {}, evaluationAt: '2026-10-07T00:00:00Z' };
    const result = evaluateAutomation(input);
    expect(result.outcome).toEqual({ type: 'ESCALATION_POLICY', policyId: 'policy-b' });
    expect(result.tags).toEqual(['vip']);
    expect(result.enrichedContext.priority).toEqual({ state: 'RECOGNIZED', value: 'P1' });
    expect(evaluateAutomation(input)).toEqual(result);
  });
  it('never invents a route for randomized contexts', () => {
    for (let n = 0; n < 100; n++) {
      const version = compileAutomation({ schemaVersion: 1, fields: [], rules: [{ id: 'route', name: 'Route', phase: 'ROUTE', conditions: [{ fieldKey: 'priority', operator: 'EQ', value: 'P1' }], actions: [{ type: 'NO_ESCALATION' }] }] }).compiled;
      const result = evaluateAutomation({ version, initialContext: { priority: { state: 'RECOGNIZED', value: `P${1 + n % 5}` } }, evaluationAt: '2026-10-07T00:00:00Z' });
      expect(['NO_ESCALATION', 'SERVICE_DEFAULT']).toContain(result.outcome.type);
    }
  });
  it('does not treat nullable priority as a catch all', () => {
    expect(compileAutomation({ schemaVersion: 1, fields: [], rules: [{ id: 'none', name: 'None', phase: 'ROUTE', conditions: [{ fieldKey: 'priority', operator: 'IS_SET' }], actions: [{ type: 'NO_ESCALATION' }] }] }).issues).toEqual([]);
  });
});
