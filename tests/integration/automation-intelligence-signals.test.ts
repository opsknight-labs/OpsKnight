import { beforeEach, expect, it } from 'vitest';
import { createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { loadServiceSignals } from '@/lib/automation/intelligence-signals';

beforeEach(resetDatabase);

const HOUR = 3_600_000;
const NOW = new Date('2026-11-14T12:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

it("reads each objective's latest decided snapshot before the range, plus those inside it", async () => {
  const service = await createTestService('SLO');
  const objective = (activeTo: Date | null = null) =>
    db.serviceObjective.create({
      data: {
        lineageId: `lineage-${Math.random()}`,
        serviceId: service.id,
        name: 'Uptime',
        metricType: 'UPTIME',
        target: 99.9,
        comparator: 'GREATER_THAN_OR_EQUAL',
        windowType: 'SEVEN_DAYS',
        activeFrom: ago(100),
        activeTo,
      },
    });
  const live = await objective();
  const retired = await objective(ago(48));
  const snapshot = (objectiveId: string, endHoursAgo: number, breached: boolean | null) =>
    db.serviceObjectiveSnapshot.create({
      data: {
        objectiveId,
        periodStart: ago(endHoursAgo + 1),
        periodEnd: ago(endHoursAgo),
        target: 99.9,
        breached,
        dataState: breached === null ? 'NO_DATA' : 'AVAILABLE',
        definitionVersion: 1,
      },
    });
  await snapshot(live.id, 30, true);
  await snapshot(live.id, 10, false); // the latest decided one before the range
  await snapshot(live.id, 5, null); // undecided: ignored
  await snapshot(live.id, 0.5, true); // inside the range
  await snapshot(retired.id, 60, true); // its objective ended before the range

  const signals = await loadServiceSignals(db, { from: ago(1), to: NOW });
  const slo = signals.get(service.id)?.slo ?? [];
  expect(slo.map(item => [item.objectiveId, item.endAt, item.breached])).toEqual(
    expect.arrayContaining([
      [live.id, ago(10).getTime(), false],
      [live.id, ago(0.5).getTime(), true],
    ])
  );
  expect(slo).toHaveLength(2);
});
