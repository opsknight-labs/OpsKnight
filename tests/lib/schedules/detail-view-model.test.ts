import { describe, expect, it } from 'vitest';
import type { OnCallBlock } from '@/lib/oncall';
import {
  buildScheduleDetailViewModel,
  classifyOverride,
  getOverrideKind,
} from '@/lib/schedules/detail-view-model';
import { parseDateTimeInTimeZone } from '@/lib/timezone';

function block(
  id: string,
  userId: string,
  userName: string,
  start: string,
  end: string,
  extra: Partial<OnCallBlock> = {}
): OnCallBlock {
  return {
    id,
    userId,
    userName,
    start: new Date(start),
    end: new Date(end),
    layerId: 'primary',
    layerName: 'Final Schedule',
    source: 'rotation',
    ...extra,
  };
}

describe('schedule detail view model', () => {
  const now = new Date('2026-08-29T10:00:00.000Z');

  it('derives current responders and the next effective handoff from canonical blocks', () => {
    const model = buildScheduleDetailViewModel({
      now,
      finalCoverageBlocks: [
        block('alex', 'alex', 'Alex', '2026-08-29T08:00:00Z', '2026-08-29T12:00:00Z'),
        block('sam', 'sam', 'Sam', '2026-08-29T12:00:00Z', '2026-08-29T16:00:00Z'),
      ],
      overrides: [],
      layerCount: 1,
      participantIds: ['alex', 'sam'],
    });

    expect(model.currentCoverage.map(item => item.userName)).toEqual(['Alex']);
    expect(model.nextCoverageChange?.at.toISOString()).toBe('2026-08-29T12:00:00.000Z');
    expect(model.nextCoverageChange?.coverage.map(item => item.userName)).toEqual(['Sam']);
    expect(model.summary).toBe('Alex is on call');
  });

  it('preserves multiple current responders including additive coverage', () => {
    const model = buildScheduleDetailViewModel({
      now,
      finalCoverageBlocks: [
        block('alex', 'alex', 'Alex', '2026-08-29T08:00:00Z', '2026-08-29T12:00:00Z'),
        block('extra', 'sam', 'Sam', '2026-08-29T09:00:00Z', '2026-08-29T11:00:00Z', {
          source: 'override',
          isAdditiveOverride: true,
        }),
      ],
      overrides: [],
      layerCount: 2,
      participantIds: ['alex', 'sam', 'alex'],
    });

    expect(model.currentCoverage.map(item => item.userName)).toEqual(['Alex', 'Sam']);
    expect(model.nextCoverageChange?.at.toISOString()).toBe('2026-08-29T11:00:00.000Z');
    expect(model.nextCoverageChange?.coverage.map(item => item.userName)).toEqual(['Alex']);
    expect(model.participantCount).toBe(2);
  });

  it('classifies replacement and additive overrides at exact boundaries', () => {
    const activeAtStart = { start: now, end: new Date('2026-08-29T11:00:00Z') };
    const completedAtEnd = { start: new Date('2026-08-29T09:00:00Z'), end: now };

    expect(classifyOverride(activeAtStart, now)).toBe('ACTIVE');
    expect(classifyOverride(completedAtEnd, now)).toBe('COMPLETED');
    expect(
      classifyOverride(
        { start: new Date('2026-08-29T10:00:00.001Z'), end: new Date('2026-08-29T11:00:00Z') },
        now
      )
    ).toBe('UPCOMING');
    expect(getOverrideKind({ replacesUserId: 'alex' })).toBe('REPLACEMENT');
    expect(getOverrideKind({ replacesUserId: null })).toBe('ADDITIVE');
  });

  it('reports a gap and the next future coverage block', () => {
    const model = buildScheduleDetailViewModel({
      now,
      finalCoverageBlocks: [
        block('future', 'sam', 'Sam', '2026-08-29T11:00:00Z', '2026-08-29T12:00:00Z'),
      ],
      overrides: [],
      layerCount: 1,
      participantIds: ['sam'],
    });

    expect(model.coverageGap).toBe(true);
    expect(model.nextCoverage?.userName).toBe('Sam');
    expect(model.nextCoverageChange?.coverage.map(item => item.userName)).toEqual(['Sam']);
  });

  it('uses timezone-resolved instants across DST and fractional offsets', () => {
    const dstStart = parseDateTimeInTimeZone('2026-11-01T01:30', 'America/New_York');
    const fractionalStart = parseDateTimeInTimeZone('2026-08-29T15:45', 'Asia/Kathmandu');

    expect(dstStart).toBeNull();
    expect(fractionalStart?.toISOString()).toBe('2026-08-29T10:00:00.000Z');
    expect(
      classifyOverride(
        {
          start: fractionalStart!,
          end: new Date('2026-08-29T11:00:00.000Z'),
        },
        now
      )
    ).toBe('ACTIVE');
  });
});
