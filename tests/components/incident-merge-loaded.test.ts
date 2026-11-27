import { describe, expect, it } from 'vitest';
import { mergeLatestWithOlder } from '@/components/incident/detail/merge-loaded';

const row = (id: string, at: string) => ({ id, createdAt: new Date(at) });

describe('mergeLatestWithOlder', () => {
  const page1 = [row('c', '2026-01-03'), row('b', '2026-01-02')];
  const olderLoaded = [row('a', '2026-01-01')];

  it('keeps older rows the viewer already paged in below the refreshed newest page', () => {
    const refreshed = [row('d', '2026-01-04'), row('c', '2026-01-03'), row('b', '2026-01-02')];

    const merged = mergeLatestWithOlder(refreshed, [...page1, ...olderLoaded]);

    expect(merged.map(item => item.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('does not duplicate rows that slid into the newest page', () => {
    const merged = mergeLatestWithOlder([row('b', '2026-01-02'), row('a', '2026-01-01')], [
      ...page1,
      ...olderLoaded,
    ]);

    expect(merged.map(item => item.id)).toEqual(['b', 'a']);
  });

  it('returns the incoming list itself when nothing older was loaded', () => {
    const latest = [row('c', '2026-01-03')];
    expect(mergeLatestWithOlder(latest, [row('c', '2026-01-03')])).toBe(latest);
    expect(mergeLatestWithOlder([], olderLoaded)).toEqual([]);
  });
});
