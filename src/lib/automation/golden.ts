import operators from '../../../tests/fixtures/automation/operators.json';
import pipeline from '../../../tests/fixtures/automation/pipeline.json';
import { conditionSchema, fieldSchema, type FieldState, type Context } from './contract';
import { normalizeValue } from './context/normalize';
import { evaluateOperator } from './evaluator/operators';
import { evaluateAutomation } from './evaluator';
import { compileAutomation } from './compiler';
/** The same portable fixtures drive unit tests, test API, and the sample tester. */
export function goldenResults() {
  const results = operators.map(f => ({
    name: f.name,
    expected: String(f.expected),
    actual: String(evaluateOperator(f.field as FieldState, conditionSchema.parse(f.condition))),
  }));
  for (const fixture of pipeline) {
    let actual: unknown;
    try {
      if (fixture.kind === 'normalize')
        actual = normalizeValue(fixture.raw, fieldSchema.parse(fixture.field));
      else if (fixture.kind === 'lint')
        actual =
          compileAutomation(fixture.snapshot).issues.find(i => i.code === fixture.expected)?.code ??
          'NO_ERROR';
      else {
        const result = evaluateAutomation({
          version: compileAutomation(fixture.snapshot).compiled,
          initialContext: fixture.context as Context,
          evaluationAt: '2026-10-07T00:00:00Z',
          ...(fixture.kind === 'timeout'
            ? {
                guard: () => {
                  throw new Error('EVALUATION_TIMEOUT');
                },
              }
            : {}),
        });
        actual = {
          outcome: result.outcome,
          tags: result.tags,
          priority:
            result.enrichedContext.priority?.state === 'RECOGNIZED'
              ? result.enrichedContext.priority.value
              : null,
        };
      }
    } catch (err) {
      actual = err instanceof Error ? err.message : 'ERROR';
    }
    results.push({
      name: fixture.name,
      expected: JSON.stringify(fixture.expected),
      actual: JSON.stringify(actual),
    });
  }
  return results;
}
