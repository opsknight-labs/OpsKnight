import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileAutomation } from '@/lib/automation/compiler';
import { evaluateAutomation } from '@/lib/automation/evaluator';
import { evaluateOperator } from '@/lib/automation/evaluator/operators';
import { emptySnapshot, type Context } from '@/lib/automation/contract';
it('keeps negative comparisons unknown across missing and unmapped input families', () => {
  for (let seed = 0; seed < 250; seed++)
    for (const operator of ['NE', 'NOT_IN'] as const) {
      for (const field of [
        { state: 'MISSING' as const },
        { state: 'UNMAPPED' as const, raw: `unknown-${seed}` },
      ])
        expect(
          evaluateOperator(field, {
            fieldKey: 'source',
            operator,
            value: operator === 'NE' ? `value-${seed}` : [`value-${seed}`],
          })
        ).toBe('UNKNOWN');
    }
});
it('is deterministic across generated priorities, conditions and rule orders', () => {
  for (let seed = 0; seed < 100; seed++) {
    const { compiled } = compileAutomation({
      ...emptySnapshot,
      rules: [
        {
          id: 'enrich',
          name: 'Priority',
          enabled: true,
          phase: 'ENRICH',
          conditions: [],
          actions: [{ type: 'SET_PRIORITY', value: ['P1', 'P2', 'P3', 'P4', 'P5'][seed % 5] }],
        },
        {
          id: 'route',
          name: 'Route',
          phase: 'ROUTE',
          enabled: true,
          conditions: [{ fieldKey: 'priority', operator: 'IN', value: ['P1', 'P2'] }],
          actions: [{ type: 'USE_SERVICE_DEFAULT' }],
        },
      ],
    });
    const context: Context = {
      priority: seed % 2 ? { state: 'MISSING' } : { state: 'RECOGNIZED', value: 'P3' },
    };
    const before = structuredClone(context);
    const input = {
      version: compiled,
      initialContext: context,
      evaluationAt: '2026-10-07T00:00:00Z',
    };
    expect(evaluateAutomation(input)).toEqual(evaluateAutomation(input));
    expect(context).toEqual(before);
  }
});
it('has no IO or clock access inside the pure evaluation modules', () => {
  for (const file of ['index', 'enrich', 'route', 'conditions', 'operators']) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed evaluator module names above.
    const source = readFileSync(`src/lib/automation/evaluator/${file}.ts`, 'utf8');
    expect(source).not.toMatch(
      /prisma|fetch\(|axios|https?:|process\.env|Date\.now|performance\.now|from ['"](?:fs|node:fs|crypto|node:crypto)/
    );
  }
});
