import { expect, it } from 'vitest';
import {
  summarizeAutomationTimings,
  type ComponentTimingCapture,
} from '../load/helpers/automation-timings';

function capture(instances: Array<[string, number, number]>): ComponentTimingCapture {
  return {
    source: 'PER_WEB_POD',
    errors: [],
    instances: instances.map(([id, count, sum]) => ({
      id,
      name: id,
      metrics: {
        'opsknight_event_transaction_duration_ms_count{action="triggered"}': count,
        'opsknight_event_transaction_duration_ms_sum{action="triggered"}': sum,
        'opsknight_event_transaction_duration_ms_bucket{action="triggered",le="120"}': count,
      },
    })),
  };
}
it('subtracts pre-profile traffic and combines all replica counters while retaining raw buckets', () => {
  const before = capture([
    ['a', 10, 100],
    ['b', 20, 200],
  ]);
  const after = capture([
    ['a', 12, 150],
    ['b', 23, 290],
  ]);
  const summary = summarizeAutomationTimings(before, after);
  expect(summary.complete).toBe(true);
  expect(summary.components.incidentTransaction).toEqual({ count: 5, sumMs: 140, meanMs: 28 });
  expect(summary.before).toEqual(before);
  expect(summary.after).toEqual(after);
});
it('marks replacement, counter resets, scrape errors and load-balanced reads as partial', () => {
  const before = capture([
    ['a', 10, 100],
    ['b', 20, 200],
  ]);
  const replaced = summarizeAutomationTimings(
    before,
    capture([
      ['a', 12, 150],
      ['new-b', 3, 90],
    ])
  );
  expect(replaced.complete).toBe(false);
  expect(replaced.lostInstances).toEqual(['b']);
  expect(replaced.components.incidentTransaction.count).toBe(5);
  const reset = summarizeAutomationTimings(
    before,
    capture([
      ['a', 2, 30],
      ['b', 21, 225],
    ])
  );
  expect(reset.complete).toBe(false);
  expect(reset.counterResets).toEqual(['a:incidentTransaction']);
  expect(
    summarizeAutomationTimings(before, { ...before, errors: ['scrape failed'] }).complete
  ).toBe(false);
  expect(
    summarizeAutomationTimings({ ...before, source: 'LOAD_BALANCED_ENDPOINT' }, before).complete
  ).toBe(false);
});
