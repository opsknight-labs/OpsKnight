import { describe, expect, it } from 'vitest';
import { buildScheduleBlocks, getFinalScheduleBlocks } from '../oncall';

const baseDate = new Date('2025-12-01T00:00:00Z');

function hoursFromBase(hours: number) {
  const date = new Date(baseDate);
  date.setHours(date.getHours() + hours);
  return date;
}

const layer = {
  id: 'layer-1',
  name: 'Primary Team',
  start: baseDate,
  end: null,
  rotationLengthHours: 24,
  users: [
    { userId: 'user-a', user: { name: 'Alice' }, position: 0 },
    { userId: 'user-b', user: { name: 'Bob' }, position: 1 },
  ],
};

describe('buildScheduleBlocks', () => {
  it('rotates users daily', () => {
    const blocks = buildScheduleBlocks([layer], [], hoursFromBase(24), hoursFromBase(72));

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks[0].userId).toBe('user-b');
    expect(blocks[0].end.getTime()).toBe(hoursFromBase(48).getTime());
    expect(blocks[blocks.length - 1].userId).toBe('user-a');
  });

  it('applies overrides and respects replace rules', () => {
    const overrides = [
      {
        id: 'override-1',
        userId: 'user-c',
        user: { name: 'Charlie' },
        start: hoursFromBase(30),
        end: hoursFromBase(42),
        replacesUserId: null,
      },
    ];

    const blocks = buildScheduleBlocks([layer], overrides, hoursFromBase(24), hoursFromBase(72));

    const overrideBlock = blocks.find(block => block.id.includes('override-1'));
    expect(overrideBlock).toBeDefined();
    expect(overrideBlock?.userId).toBe('user-c');
    expect(overrideBlock?.start.getTime()).toBe(hoursFromBase(30).getTime());
    expect(overrideBlock?.end.getTime()).toBe(hoursFromBase(42).getTime());
  });

  it('emits one additive override across multiple layers without suppressing rotation', () => {
    const secondary = { ...layer, id: 'layer-2', name: 'Secondary' };
    const overrides = [
      {
        id: 'override-add',
        userId: 'user-c',
        user: { name: 'Charlie' },
        start: hoursFromBase(30),
        end: hoursFromBase(42),
        replacesUserId: null,
      },
    ];
    const blocks = buildScheduleBlocks(
      [layer, secondary],
      overrides,
      hoursFromBase(24),
      hoursFromBase(48)
    );
    expect(blocks.filter(block => block.isAdditiveOverride)).toHaveLength(1);
    const final = getFinalScheduleBlocks(
      blocks,
      new Map([
        ['layer-1', 2],
        ['layer-2', 1],
      ])
    );
    expect(final.some(block => block.isAdditiveOverride && block.userId === 'user-c')).toBe(true);
    expect(final.some(block => block.source === 'rotation')).toBe(true);
  });

  it('clips additive overrides to the requested coverage window', () => {
    const blocks = buildScheduleBlocks(
      [],
      [
        {
          id: 'wide-override',
          userId: 'user-c',
          user: { name: 'Charlie' },
          start: hoursFromBase(0),
          end: hoursFromBase(72),
          replacesUserId: null,
        },
      ],
      hoursFromBase(24),
      hoursFromBase(48)
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].start).toEqual(hoursFromBase(24));
    expect(blocks[0].end).toEqual(hoursFromBase(48));
  });

  it('preserves layer precedence when replacement overrides overlap', () => {
    const primary = { ...layer, id: 'z-primary', users: [layer.users[0]] };
    const fallback = { ...layer, id: 'a-fallback', users: [layer.users[1]] };
    const blocks = buildScheduleBlocks(
      [primary, fallback],
      [
        {
          id: 'primary-override',
          userId: 'primary-cover',
          user: { name: 'Primary Cover' },
          start: hoursFromBase(0),
          end: hoursFromBase(24),
          replacesUserId: 'user-a',
        },
        {
          id: 'fallback-override',
          userId: 'fallback-cover',
          user: { name: 'Fallback Cover' },
          start: hoursFromBase(0),
          end: hoursFromBase(24),
          replacesUserId: 'user-b',
        },
      ],
      hoursFromBase(0),
      hoursFromBase(24)
    );

    const final = getFinalScheduleBlocks(
      blocks,
      new Map([
        ['z-primary', 10],
        ['a-fallback', 0],
      ])
    );
    expect(final).toHaveLength(1);
    expect(final[0].userId).toBe('primary-cover');
  });

  it('creates gaps when shiftLengthHours is less than rotationLengthHours', () => {
    const layerWithShiftRestriction = {
      ...layer,
      rotationLengthHours: 24,
      shiftLengthHours: 12, // 12h on, 12h off
    };

    const blocks = buildScheduleBlocks(
      [layerWithShiftRestriction],
      [],
      hoursFromBase(0), // Start at base
      hoursFromBase(48) // 2 days
    );

    // Should have 2 blocks (one per day), each 12 hours long
    expect(blocks.length).toBe(2);

    // First block: 0-12h (Alice)
    expect(blocks[0].userId).toBe('user-a');
    expect(blocks[0].start.getTime()).toBe(hoursFromBase(0).getTime());
    expect(blocks[0].end.getTime()).toBe(hoursFromBase(12).getTime());

    // Second block: 24-36h (Bob) - gap from 12-24h
    expect(blocks[1].userId).toBe('user-b');
    expect(blocks[1].start.getTime()).toBe(hoursFromBase(24).getTime());
    expect(blocks[1].end.getTime()).toBe(hoursFromBase(36).getTime());
  });

  it('anchors 12-hour sub-daily rotations across DST boundaries without wall-clock drift', () => {
    // America/New_York springs forward on 2026-03-08 (23-hour day)
    const tz = 'America/New_York';
    const nyLayer = {
      id: 'layer-12h',
      name: '12h Team',
      start: new Date('2026-03-07T13:00:00.000Z'), // 08:00 EST (UTC-5)
      end: null,
      rotationLengthHours: 12,
      users: [
        { userId: 'user-day', user: { name: 'Day Responder' }, position: 0 },
        { userId: 'user-night', user: { name: 'Night Responder' }, position: 1 },
      ],
    };

    const windowStart = new Date('2026-03-07T13:00:00.000Z');
    const windowEnd = new Date('2026-03-10T13:00:00.000Z');

    const blocks = buildScheduleBlocks([nyLayer], [], windowStart, windowEnd, tz);

    expect(blocks.length).toBeGreaterThanOrEqual(6);
    // Post-DST shift on 2026-03-09 at 08:00 EDT (UTC-4) -> 12:00 UTC
    const march9DayShift = blocks.find(
      b => b.userId === 'user-day' && b.start.toISOString().startsWith('2026-03-09')
    );
    expect(march9DayShift).toBeDefined();
    expect(march9DayShift?.start.toISOString()).toBe('2026-03-09T12:00:00.000Z');
  });
});
