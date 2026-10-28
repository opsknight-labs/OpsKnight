import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const { capacityStage, stageComplete, stageUnclaimed, cpuUsageDelta } = createRequire(
  import.meta.url
)('../../scripts/ingestion/capacity-stages.cjs');

describe('independent capacity stage gates', () => {
  it('keeps the existing full-stack mode as default and rejects misspelled stages', () => {
    expect(capacityStage()).toBe('full-stack');
    expect(capacityStage('admission-only')).toBe('admission-only');
    expect(() => capacityStage('incident')).toThrow();
  });
  it('requires incident, alert and receipt reconciliation rather than only claimed work', () => {
    const fixture = { stage: 'incident-only', count: 10, expectedOutbox: 60 };
    const completed = {
      accepted: 10,
      completed: 10,
      incidents: 10,
      alerts: 10,
      outboxJobs: 60,
      pending: 0,
      failed: 0,
    };
    expect(stageComplete(fixture, completed)).toBe(true);
    expect(stageComplete(fixture, { ...completed, outboxJobs: 0 })).toBe(false);
    expect(stageComplete(fixture, { ...completed, alerts: 9 })).toBe(false);
    expect(stageComplete(fixture, { ...completed, pending: 1 })).toBe(false);
  });
  it('does not credit parent completion while a child delivery is pending or failed', () => {
    const fixture = { stage: 'effects-only', initialJobs: 60 };
    expect(stageComplete(fixture, { completed: 80, pending: 0, failed: 0 })).toBe(true);
    expect(stageComplete(fixture, { completed: 60, pending: 20, failed: 0 })).toBe(false);
    expect(stageComplete(fixture, { completed: 60, pending: 0, failed: 1 })).toBe(false);
    expect(stageComplete(fixture, { completed: 0, pending: 0, failed: 0 })).toBe(false);
  });
});

it('rejects fixtures partially consumed before publication', () => {
  const fixture = { stage: 'incident-only', count: 10 };
  const untouched = { accepted: 10, unclaimed: 10, incidents: 0, alerts: 0, outboxJobs: 0 };
  expect(stageUnclaimed(fixture, untouched)).toBe(true);
  expect(stageUnclaimed(fixture, { ...untouched, unclaimed: 9 })).toBe(false);
  expect(
    stageUnclaimed(
      { stage: 'effects-only', initialJobs: 6 },
      { jobs: [{ status: 'PENDING', count: 6, maxAttemptsUsed: 1 }] }
    )
  ).toBe(false);
  expect(
    stageUnclaimed(
      { stage: 'effects-only', initialJobs: 6 },
      { jobs: [{ status: 'COMPLETED', count: 6, maxAttemptsUsed: 1 }] }
    )
  ).toBe(false);
});

it('rejects missing/reset CPU counters and crashed image processes', () => {
  const before = [{ name: 'worker', cgroup: { cpu: { usage_usec: 1000000 } } }];
  const after = [
    { name: 'worker', running: true, oomKilled: false, cgroup: { cpu: { usage_usec: 3000000 } } },
  ];
  expect(cpuUsageDelta(before, after).totalCpuSeconds).toBe(2);
  expect(() => cpuUsageDelta(before, [{ ...after[0], running: false }])).toThrow();
  expect(() =>
    cpuUsageDelta(before, [{ ...after[0], cgroup: { cpu: { usage_usec: 0 } } }])
  ).toThrow();
});
