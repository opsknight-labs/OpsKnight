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

  it('does not keep a row that vanished from the newest page at the same instant', () => {
    const latest = [row('c', '2026-01-03'), row('b', '2026-01-02')];
    // 'x' shares the oldest timestamp but is absent from the fresh page, so it was removed.
    const merged = mergeLatestWithOlder(latest, [...latest, row('x', '2026-01-02')]);

    expect(merged.map(item => item.id)).toEqual(['c', 'b']);
  });

  it('returns the incoming list itself when nothing older was loaded', () => {
    const latest = [row('c', '2026-01-03')];
    expect(mergeLatestWithOlder(latest, [row('c', '2026-01-03')])).toBe(latest);
    expect(mergeLatestWithOlder([], [])).toEqual([]);
  });

  it('keeps what the viewer paged in when the refreshed newest page is empty', () => {
    // The first page is trimmed to the span all tables cover, so it can come back empty.
    const loaded = [...page1, ...olderLoaded];

    const merged = mergeLatestWithOlder<(typeof loaded)[number]>([], loaded);

    expect(merged.map(item => item.id)).toEqual(['c', 'b', 'a']);
    expect(merged).not.toBe(loaded);
  });
});
