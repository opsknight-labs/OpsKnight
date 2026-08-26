import { describe, expect, it } from 'vitest';
import { buildScheduleBlocks } from '../oncall';

function expectContinuousCoverage(blocks: Array<{ start: Date; end: Date }>) {
  let previous: { start: Date; end: Date } | undefined;
  for (const block of blocks) {
    if (previous) {
      expect(previous.end.getTime()).toBe(block.start.getTime());
    }
    previous = block;
  }
}

// Regression: restrictions should be evaluated in the schedule timezone, not server/local time.
describe('buildScheduleBlocks timezone-aware restrictions', () => {
  it('skips a block when local day is allowed but schedule timezone day is not', () => {
    // Layer starts at Monday 00:00 in America/Los_Angeles (which is 08:00 UTC on Sunday).
    const layerStart = new Date('2025-12-01T08:00:00Z'); // Monday 00:00 PST
    const layer = {
      id: 'layer-1',
      name: 'Primary',
      start: layerStart,
      end: null as Date | null,
      rotationLengthHours: 24,
      users: [{ userId: 'u1', user: { name: 'User One' }, position: 0 }],
      restrictions: {
        daysOfWeek: [0], // Sunday only
      },
    };

    // Window covers the Monday in PST; server time is irrelevant
    const windowStart = new Date('2025-12-01T00:00:00-08:00'); // Monday 00:00 PST
    const windowEnd = new Date('2025-12-02T00:00:00-08:00'); // Tuesday 00:00 PST

    const blocks = buildScheduleBlocks([layer], [], windowStart, windowEnd, 'America/Los_Angeles');

    // Because restriction allows only Sunday, Monday block should be skipped.
    expect(blocks.length).toBe(0);
  });

  it('preserves wall-clock start time across DST spring-forward boundary', () => {
    const layerStart = new Date('2026-03-07T05:00:00Z'); // 2026-03-07 00:00 EST
    const layer = {
      id: 'layer-dst',
      name: 'DST Test',
      start: layerStart,
      end: null as Date | null,
      rotationLengthHours: 24,
      users: [
        { userId: 'u1', user: { name: 'User 1' }, position: 0 },
        { userId: 'u2', user: { name: 'User 2' }, position: 1 },
        { userId: 'u3', user: { name: 'User 3' }, position: 2 },
      ],
    };

    const windowStart = new Date('2026-03-07T05:00:00Z');
    const windowEnd = new Date('2026-03-10T04:00:00Z');

    const blocks = buildScheduleBlocks([layer], [], windowStart, windowEnd, 'America/New_York');

    expect(blocks.length).toBe(3);
    expect(blocks[0].start.toISOString()).toBe('2026-03-07T05:00:00.000Z');
    expect(blocks[1].start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(blocks[2].start.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('anchors sub-daily shift ends to local time across spring-forward', () => {
    const layer = {
      id: 'subdaily-spring',
      name: 'Night Shift',
      start: new Date('2026-03-08T01:00:00.000Z'), // 20:00 EST
      end: null,
      rotationLengthHours: 12,
      shiftLengthHours: 12,
      users: [{ userId: 'u1', user: { name: 'User One' }, position: 0 }],
    };
    const blocks = buildScheduleBlocks(
      [layer],
      [],
      layer.start,
      new Date('2026-03-08T20:00:00.000Z'),
      'America/New_York'
    );
    expect(blocks[0].end.toISOString()).toBe('2026-03-08T12:00:00.000Z'); // 08:00 EDT
    expect(blocks[0].end.getTime() - blocks[0].start.getTime()).toBe(11 * 3600_000);
  });

  it('anchors sub-daily shift ends to local time across fall-back', () => {
    const layer = {
      id: 'subdaily-fall',
      name: 'Night Shift',
      start: new Date('2026-11-01T00:00:00.000Z'), // 20:00 EDT
      end: null,
      rotationLengthHours: 12,
      shiftLengthHours: 12,
      users: [{ userId: 'u1', user: { name: 'User One' }, position: 0 }],
    };
    const blocks = buildScheduleBlocks(
      [layer],
      [],
      layer.start,
      new Date('2026-11-01T20:00:00.000Z'),
      'America/New_York'
    );
    expect(blocks[0].end.toISOString()).toBe('2026-11-01T13:00:00.000Z'); // 08:00 EST
    expect(blocks[0].end.getTime() - blocks[0].start.getTime()).toBe(13 * 3600_000);
  });

  it('keeps 1-hour wall-clock rotations continuous through spring-forward', () => {
    const layer = {
      id: 'hourly-spring',
      name: 'Hourly',
      start: new Date('2026-03-08T05:00:00.000Z'), // 00:00 EST
      end: null,
      rotationLengthHours: 1,
      users: [
        { userId: 'u1', user: { name: 'User One' }, position: 0 },
        { userId: 'u2', user: { name: 'User Two' }, position: 1 },
      ],
    };
    const blocks = buildScheduleBlocks(
      [layer],
      [],
      layer.start,
      new Date('2026-03-08T12:00:00.000Z'),
      'America/New_York'
    );

    expectContinuousCoverage(blocks);
    expect(blocks[0].start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(blocks[blocks.length - 1].end.toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(blocks.every(block => block.end > block.start)).toBe(true);
  });

  it('keeps 1-hour wall-clock rotations continuous through fall-back', () => {
    const layer = {
      id: 'hourly-fall',
      name: 'Hourly',
      start: new Date('2026-11-01T04:00:00.000Z'), // 00:00 EDT
      end: null,
      rotationLengthHours: 1,
      users: [
        { userId: 'u1', user: { name: 'User One' }, position: 0 },
        { userId: 'u2', user: { name: 'User Two' }, position: 1 },
      ],
    };
    const blocks = buildScheduleBlocks(
      [layer],
      [],
      layer.start,
      new Date('2026-11-01T10:00:00.000Z'),
      'America/New_York'
    );

    expectContinuousCoverage(blocks);
    expect(blocks[1].end.getTime() - blocks[1].start.getTime()).toBe(2 * 3600_000);
  });

  it('never moves a layer that starts in the second fall-back occurrence before its exact start', () => {
    const layer = {
      id: 'fall-second-occurrence',
      name: 'Second Occurrence',
      start: new Date('2026-11-01T06:30:00.000Z'), // 01:30 EST, the second 01:30
      end: null,
      rotationLengthHours: 1,
      users: [
        { userId: 'u1', user: { name: 'User One' }, position: 0 },
        { userId: 'u2', user: { name: 'User Two' }, position: 1 },
      ],
    };

    const blocks = buildScheduleBlocks(
      [layer],
      [],
      new Date('2026-11-01T05:00:00.000Z'),
      new Date('2026-11-01T10:00:00.000Z'),
      'America/New_York'
    );

    expect(blocks[0].start.toISOString()).toBe('2026-11-01T06:30:00.000Z');
    expect(blocks.every(block => block.start >= layer.start)).toBe(true);
    expectContinuousCoverage(blocks);
  });

  it('keeps full-day timezone jumps monotonic without duplicate coverage', () => {
    const layer = {
      id: 'apia-hourly',
      name: 'Apia Hourly',
      start: new Date('2011-12-29T10:00:00.000Z'), // 2011-12-29 00:00 -10
      end: null,
      rotationLengthHours: 1,
      users: [
        { userId: 'u1', user: { name: 'User One' }, position: 0 },
        { userId: 'u2', user: { name: 'User Two' }, position: 1 },
        { userId: 'u3', user: { name: 'User Three' }, position: 2 },
      ],
    };

    const windowEnd = new Date('2012-01-02T10:00:00.000Z');
    const blocks = buildScheduleBlocks([layer], [], layer.start, windowEnd, 'Pacific/Apia');
    const uniqueIntervals = new Set(
      blocks.map(block => `${block.start.getTime()}-${block.end.getTime()}`)
    );

    expect(blocks).toHaveLength(96);
    expect(uniqueIntervals.size).toBe(blocks.length);
    expect(blocks[0].start.getTime()).toBe(layer.start.getTime());
    expect(blocks[blocks.length - 1].end.getTime()).toBe(windowEnd.getTime());
    expect(blocks.every(block => block.end > block.start)).toBe(true);
    expectContinuousCoverage(blocks);
  });

  it('fast-forwards safely past a full-day timezone jump', () => {
    const layer = {
      id: 'apia-fast-forward',
      name: 'Apia Fast Forward',
      start: new Date('2011-12-29T10:00:00.000Z'),
      end: null,
      rotationLengthHours: 1,
      users: [
        { userId: 'u1', user: { name: 'User One' }, position: 0 },
        { userId: 'u2', user: { name: 'User Two' }, position: 1 },
      ],
    };
    const windowStart = new Date('2012-02-01T10:00:00.000Z');
    const windowEnd = new Date('2012-02-02T10:00:00.000Z');

    const blocks = buildScheduleBlocks([layer], [], windowStart, windowEnd, 'Pacific/Apia');
    expect(blocks).toHaveLength(24);
    expect(blocks[0].start.getTime()).toBe(windowStart.getTime());
    expect(blocks[blocks.length - 1].end.getTime()).toBe(windowEnd.getTime());
    expectContinuousCoverage(blocks);
  });

  it('uses fixed elapsed semantics for arbitrary sub-daily rotations without DST gaps', () => {
    const layer = {
      id: 'five-hour',
      name: 'Five Hour',
      start: new Date('2026-03-08T05:00:00.000Z'), // 00:00 EST
      end: null,
      rotationLengthHours: 5,
      users: [
        { userId: 'u1', user: { name: 'User One' }, position: 0 },
        { userId: 'u2', user: { name: 'User Two' }, position: 1 },
      ],
    };
    const blocks = buildScheduleBlocks(
      [layer],
      [],
      layer.start,
      new Date('2026-03-09T06:00:00.000Z'),
      'America/New_York'
    );

    expectContinuousCoverage(blocks);
    for (const block of blocks) {
      expect(block.end.getTime() - block.start.getTime()).toBe(5 * 3600_000);
    }
  });

  it('splits multi-day rotation block into hourly sub-blocks matching restriction window', () => {
    const layerStart = new Date('2025-12-01T00:00:00Z');
    const layer = {
      id: 'layer-restricted',
      name: 'Business Hours',
      start: layerStart,
      end: null as Date | null,
      rotationLengthHours: 168,
      users: [{ userId: 'u1', user: { name: 'User One' }, position: 0 }],
      restrictions: {
        daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
        startHour: 9,
        endHour: 17,
      },
    };

    const windowStart = new Date('2025-12-01T00:00:00Z');
    const windowEnd = new Date('2025-12-08T00:00:00Z');

    const blocks = buildScheduleBlocks([layer], [], windowStart, windowEnd, 'UTC');

    expect(blocks.length).toBe(5);
    expect(blocks[0].start.toISOString()).toBe('2025-12-01T09:00:00.000Z');
    expect(blocks[0].end.toISOString()).toBe('2025-12-01T17:00:00.000Z');
    expect(blocks[4].start.toISOString()).toBe('2025-12-05T09:00:00.000Z');
    expect(blocks[4].end.toISOString()).toBe('2025-12-05T17:00:00.000Z');
  });
});