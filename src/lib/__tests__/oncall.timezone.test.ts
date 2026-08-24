import { describe, expect, it } from 'vitest';
import { buildScheduleBlocks } from '../oncall';

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
    // 2026-03-07 is before DST (EST, UTC-5), 2026-03-08 is transition, 2026-03-09 is after (EDT, UTC-4)
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
    // Day 0: 2026-03-07 00:00 EST -> 05:00 UTC
    expect(blocks[0].start.toISOString()).toBe('2026-03-07T05:00:00.000Z');
    // Day 1: 2026-03-08 00:00 EST -> 05:00 UTC
    expect(blocks[1].start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    // Day 2: 2026-03-09 00:00 EDT -> 04:00 UTC (not 05:00 UTC!)
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

  it('splits multi-day rotation block into hourly sub-blocks matching restriction window', () => {
    // 168h (1 week) rotation starting Mon Dec 1 2025 00:00 UTC
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

    const windowStart = new Date('2025-12-01T00:00:00Z'); // Monday 00:00 UTC
    const windowEnd = new Date('2025-12-08T00:00:00Z'); // Next Monday 00:00 UTC

    const blocks = buildScheduleBlocks([layer], [], windowStart, windowEnd, 'UTC');

    // 5 business days, 1 block per day from 09:00 to 17:00
    expect(blocks.length).toBe(5);
    expect(blocks[0].start.toISOString()).toBe('2025-12-01T09:00:00.000Z');
    expect(blocks[0].end.toISOString()).toBe('2025-12-01T17:00:00.000Z');
    expect(blocks[4].start.toISOString()).toBe('2025-12-05T09:00:00.000Z');
    expect(blocks[4].end.toISOString()).toBe('2025-12-05T17:00:00.000Z');
  });
});
