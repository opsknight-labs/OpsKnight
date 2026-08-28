import { describe, expect, it } from 'vitest';
import { groupCalendarShiftsForDay } from '@/lib/schedules/calendar';

describe('schedule calendar day grouping', () => {
  const dayStart = new Date('2026-08-28T00:00:00.000Z');
  const dayEnd = new Date('2026-08-29T00:00:00.000Z');

  it('coalesces overnight fragments for the same responder and layer into one day entry', () => {
    const grouped = groupCalendarShiftsForDay(
      [
        {
          id: 'previous-night',
          layerId: 'layer-primary',
          userId: 'user-admin',
          source: 'layer',
          label: 'Primary: OpsKnight Admin',
          start: '2026-08-27T18:30:00.000Z',
          end: '2026-08-28T06:30:00.000Z',
        },
        {
          id: 'next-night',
          layerId: 'layer-primary',
          userId: 'user-admin',
          source: 'layer',
          label: 'Primary: OpsKnight Admin',
          start: '2026-08-28T18:30:00.000Z',
          end: '2026-08-29T06:30:00.000Z',
        },
      ],
      dayStart,
      dayEnd
    );

    expect(grouped).toHaveLength(1);
    expect(grouped[0].segments).toEqual([
      {
        start: '2026-08-28T00:00:00.000Z',
        end: '2026-08-28T06:30:00.000Z',
      },
      {
        start: '2026-08-28T18:30:00.000Z',
        end: '2026-08-29T00:00:00.000Z',
      },
    ]);
    expect(grouped[0].spansDayBoundary).toBe(true);
  });

  it('keeps the same responder separate when they belong to different layers', () => {
    const grouped = groupCalendarShiftsForDay(
      [
        {
          id: 'primary',
          layerId: 'layer-primary',
          userId: 'user-alex',
          source: 'layer',
          label: 'Primary: Alex',
          start: '2026-08-28T06:30:00.000Z',
          end: '2026-08-28T12:00:00.000Z',
        },
        {
          id: 'secondary',
          layerId: 'layer-secondary',
          userId: 'user-alex',
          source: 'layer',
          label: 'Secondary: Alex',
          start: '2026-08-28T12:00:00.000Z',
          end: '2026-08-28T18:30:00.000Z',
        },
      ],
      dayStart,
      dayEnd
    );

    expect(grouped).toHaveLength(2);
    expect(new Set(grouped.map(entry => entry.layerId))).toEqual(
      new Set(['layer-primary', 'layer-secondary'])
    );
  });

  it('does not collapse an override into a raw layer entry', () => {
    const grouped = groupCalendarShiftsForDay(
      [
        {
          id: 'layer',
          layerId: 'layer-primary',
          userId: 'user-alex',
          source: 'layer',
          label: 'Primary: Alex',
          start: '2026-08-28T06:30:00.000Z',
          end: '2026-08-28T12:00:00.000Z',
        },
        {
          id: 'override',
          layerId: 'layer-primary',
          userId: 'user-alex',
          source: 'override',
          label: 'Primary: Alex (Override)',
          start: '2026-08-28T12:00:00.000Z',
          end: '2026-08-28T18:30:00.000Z',
        },
      ],
      dayStart,
      dayEnd
    );

    expect(grouped).toHaveLength(2);
    expect(new Set(grouped.map(entry => entry.source))).toEqual(new Set(['layer', 'override']));
  });

  it('ignores invalid and non-overlapping blocks instead of poisoning the calendar', () => {
    const grouped = groupCalendarShiftsForDay(
      [
        {
          id: 'before',
          layerId: 'layer-primary',
          userId: 'user-alex',
          source: 'layer',
          label: 'Primary: Alex',
          start: '2026-08-27T01:00:00.000Z',
          end: '2026-08-27T02:00:00.000Z',
        },
        {
          id: 'invalid',
          layerId: 'layer-primary',
          userId: 'user-alex',
          source: 'layer',
          label: 'Primary: Alex',
          start: 'invalid',
          end: '2026-08-28T02:00:00.000Z',
        },
      ],
      dayStart,
      dayEnd
    );

    expect(grouped).toEqual([]);
  });
});
