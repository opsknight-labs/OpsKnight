import { describe, expect, it } from 'vitest';
import {
  hasUncoveredTime,
  isDaytimeFor,
  rankCoverCandidates,
} from '@/lib/intelligence/people/cover-rank';

const t = (iso: string) => new Date(iso);

describe('override cover ranking', () => {
  it('finds uncovered time inside a window', () => {
    const start = t('2026-11-20T10:00:00Z');
    const end = t('2026-11-20T14:00:00Z');
    expect(hasUncoveredTime([], start, end)).toBe(true);
    expect(
      hasUncoveredTime(
        [{ start: t('2026-11-20T09:00:00Z'), end: t('2026-11-20T15:00:00Z') }],
        start,
        end
      )
    ).toBe(false);
    expect(
      hasUncoveredTime(
        [
          { start: t('2026-11-20T10:00:00Z'), end: t('2026-11-20T11:00:00Z') },
          { start: t('2026-11-20T12:00:00Z'), end: t('2026-11-20T14:00:00Z') },
        ],
        start,
        end
      )
    ).toBe(true);
    expect(
      hasUncoveredTime(
        [{ start: t('2026-11-20T10:00:00Z'), end: t('2026-11-20T13:00:00Z') }],
        start,
        end
      )
    ).toBe(true);
  });

  it('treats only 08:00-22:00 on the person clock as daytime', () => {
    const start = t('2026-11-20T10:00:00Z');
    const end = t('2026-11-20T12:00:00Z');
    expect(isDaytimeFor(start, end, 'UTC')).toBe(true);
    // Auckland is UTC+13 in November: 23:00-01:00.
    expect(isDaytimeFor(start, end, 'Pacific/Auckland')).toBe(false);
    expect(isDaytimeFor(start, t('2026-11-21T10:00:00Z'), 'UTC')).toBe(false);
    expect(isDaytimeFor(t('2026-11-20T20:00:00Z'), t('2026-11-20T22:00:00Z'), 'UTC')).toBe(true);
    expect(isDaytimeFor(t('2026-11-20T20:00:00Z'), t('2026-11-20T22:30:00Z'), 'UTC')).toBe(false);
  });

  it('ranks daytime first, then fewest pages, night pages and name', () => {
    const ranked = rankCoverCandidates([
      { userId: 'a', name: 'Ann', daytime: false, pages: 0, nightPages: 0 },
      { userId: 'b', name: 'Bo', daytime: true, pages: 3, nightPages: 0 },
      { userId: 'c', name: 'Cy', daytime: true, pages: 1, nightPages: 1 },
      { userId: 'd', name: 'Di', daytime: true, pages: 1, nightPages: 0 },
      { userId: 'e', name: 'Ed', daytime: true, pages: 1, nightPages: 0 },
    ]);
    expect(ranked.map(c => c.userId)).toEqual(['d', 'e', 'c', 'b', 'a']);
  });
});
