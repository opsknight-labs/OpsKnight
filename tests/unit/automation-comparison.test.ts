import { expect, it } from 'vitest';
import {
  automationComparisonSchedule,
  controlledAutomationSchedule,
  assessControlledAutomationPair,
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

it('repeats every target in distinct OFF-target-OFF brackets', () => {
  const runs = controlledAutomationSchedule();
  expect(runs).toHaveLength(30);
  expect(new Set(runs.map(r => r.runId)).size).toBe(30);
  for (let i = 0; i < runs.length; i += 3) {
    expect(runs.at(i)!.profile).toBe('global-off');
    expect(runs.at(i + 1)!.profile).not.toBe('global-off');
    expect(runs.at(i + 2)!.profile).toBe('global-off');
    expect(new Set(runs.slice(i, i + 3).map(r => r.pairId)).size).toBe(1);
  }
  expect(() => controlledAutomationSchedule(1)).toThrow();
});
it('does not turn an unstable baseline into an Automation pass or fail', () => {
  expect(
    assessControlledAutomationPair(
      { p95: 100, p99: 100 },
      { p95: 1, p99: 1 },
      { p95: 120, p99: 100 }
    ).status
  ).toBe('INCONCLUSIVE');
  expect(
    assessControlledAutomationPair(
      { p95: 100, p99: 100 },
      { p95: 1000, p99: 1000 },
      { p95: 100, p99: 130 }
    ).status
  ).toBe('INCONCLUSIVE');
  expect(
    assessControlledAutomationPair({ p95: 0, p99: 100 }, { p95: 1, p99: 1 }, { p95: 100, p99: 100 })
      .status
  ).toBe('INCONCLUSIVE');
});
it('enforces 1.25x against both baselines and accepts exact stability boundaries', () => {
  const before = { p95: 100, p99: 100 },
    after = { p95: 115, p99: 120 };
  expect(assessControlledAutomationPair(before, { p95: 125, p99: 125 }, after).status).toBe('PASS');
  expect(assessControlledAutomationPair(before, { p95: 126, p99: 125 }, after).status).toBe('FAIL');
  expect(assessControlledAutomationPair(after, { p95: 125, p99: 126 }, before).status).toBe('FAIL');
});
