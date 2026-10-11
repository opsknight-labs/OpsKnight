import { expect, it } from 'vitest';
import {
  automationComparisonSchedule,
  precedingAutomationBaseline,
} from '../load/helpers/automation-comparison';
it('pairs each profile with a fresh preceding OFF baseline without overwriting artifacts', () => {
  const schedule = automationComparisonSchedule('interleaved');
  expect(schedule).toHaveLength(10);
  expect(new Set(schedule.map(run => run.runId)).size).toBe(10);
  for (let i = 1; i < schedule.length; i += 2) {
    expect(precedingAutomationBaseline(schedule, i)).toEqual(schedule.at(i - 1));
    expect(schedule.at(i)?.profile).not.toBe('global-off');
  }
});
it('retains single-baseline coverage and rejects missing baselines or unknown modes', () => {
  const schedule = automationComparisonSchedule();
  expect(schedule).toHaveLength(6);
  expect(precedingAutomationBaseline(schedule, 5)).toEqual(schedule.at(0));
  expect(() => precedingAutomationBaseline([{ profile: 'live-worst' }], 0)).toThrow('missing');
  expect(() => automationComparisonSchedule('invalid')).toThrow('Unknown');
});
