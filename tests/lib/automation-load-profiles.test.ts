import { it, expect } from 'vitest';
import { AUTOMATION_LOAD_PROFILES, automationLoadSnapshot } from '../load/fixtures/automation';
import { compileAutomation } from '@/lib/automation/compiler';
import { evaluateAutomation } from '@/lib/automation/evaluator';
for (const profile of AUTOMATION_LOAD_PROFILES)
  it(`compiles and deterministically evaluates ${profile}`, () => {
    const { compiled, issues } = compileAutomation(automationLoadSnapshot(profile));
    expect(issues.filter(i => i.level === 'ERROR')).toEqual([]);
    const context = Object.fromEntries(
      compiled.fields.map(f => [f.key, { state: 'RECOGNIZED' as const, value: 0 }])
    );
    const input = {
      version: compiled,
      initialContext: context,
      evaluationAt: '2026-10-07T00:00:00Z',
    };
    expect(evaluateAutomation(input)).toEqual(evaluateAutomation(input));
  });
