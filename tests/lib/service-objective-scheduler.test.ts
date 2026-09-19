import { describe, expect, it } from 'vitest';
import { getObjectiveSnapshotPeriod } from '@/jobs/service-objective-scheduler';

describe('service objective snapshot periods', () => {
  const dayEnd = new Date('2026-09-19T00:00:00.000Z');

  it('evaluates the configured objective window instead of one day', () => {
    expect(
      getObjectiveSnapshotPeriod(
        {
          windowType: 'THIRTY_DAYS',
          windowValue: null,
          activeFrom: new Date('2026-01-01T00:00:00.000Z'),
          activeTo: null,
        },
        dayEnd
      )
    ).toEqual({
      periodStart: new Date('2026-08-20T00:00:00.000Z'),
      periodEnd: dayEnd,
    });
  });

  it('clips evaluation to version activation boundaries', () => {
    expect(
      getObjectiveSnapshotPeriod(
        {
          windowType: 'THIRTY_DAYS',
          windowValue: null,
          activeFrom: new Date('2026-09-18T12:00:00.000Z'),
          activeTo: new Date('2026-09-18T18:00:00.000Z'),
        },
        dayEnd
      )
    ).toEqual({
      periodStart: new Date('2026-09-18T12:00:00.000Z'),
      periodEnd: new Date('2026-09-18T18:00:00.000Z'),
    });
  });

  it('anchors a retired revision window at its retirement time', () => {
    expect(
      getObjectiveSnapshotPeriod(
        {
          windowType: 'THIRTY_DAYS',
          windowValue: null,
          activeFrom: new Date('2026-01-01T00:00:00.000Z'),
          activeTo: new Date('2026-09-18T18:00:00.000Z'),
        },
        dayEnd
      )
    ).toEqual({
      periodStart: new Date('2026-08-19T18:00:00.000Z'),
      periodEnd: new Date('2026-09-18T18:00:00.000Z'),
    });
  });
});
