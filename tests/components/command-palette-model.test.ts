// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  MAX_RECENTS,
  RECENTS_KEY,
  groupResults,
  pushRecent,
  rankCommands,
  readRecents,
  type PaletteCommand,
  type SearchResult,
} from '@/components/command-palette/palette-model';
import {
  SEARCH_DEBOUNCE_MS,
  useEntitySearch,
} from '@/components/command-palette/use-entity-search';

const cmd = (id: string, title: string, keywords: string[] = [], subtitle?: string) =>
  ({ id, group: 'navigate', title, keywords, subtitle }) satisfies PaletteCommand;

const result = (type: SearchResult['type'], id: string): SearchResult => ({
  type,
  id,
  title: `${type} ${id}`,
  href: `/${type}s/${id}`,
});

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('rankCommands', () => {
  const commands = [
    cmd('a', 'Action Items', ['tasks']),
    cmd('b', 'Services', ['service'], 'Service registry'),
    cmd('c', 'Escalation Policies', ['routing']),
    cmd('d', 'Settings', ['slack']),
  ];

  it('returns everything in declaration order for an empty query', () => {
    expect(rankCommands(commands, '  ').map(c => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ranks title prefix above word prefix above keyword matches and drops misses', () => {
    expect(rankCommands(commands, 'se').map(c => c.id)).toEqual(['b', 'd']);
    expect(rankCommands(commands, 'pol').map(c => c.id)).toEqual(['c']);
    expect(rankCommands(commands, 'slack').map(c => c.id)).toEqual(['d']);
    expect(rankCommands(commands, 'registry').map(c => c.id)).toEqual(['b']);
    expect(rankCommands(commands, 'zzz')).toEqual([]);
  });

  it('puts an exact title match first', () => {
    const list = [cmd('x', 'Teams overview'), cmd('y', 'Teams')];
    expect(rankCommands(list, 'teams').map(c => c.id)).toEqual(['y', 'x']);
  });
});

describe('groupResults', () => {
  it('groups by entity type in palette order and skips empty groups', () => {
    const groups = groupResults([
      result('runbook', '1'),
      result('user', '2'),
      result('incident', '3'),
      result('user', '4'),
    ]);
    expect(groups.map(g => [g.label, g.items.map(i => i.id)])).toEqual([
      ['Incidents', ['3']],
      ['People', ['2', '4']],
      ['Runbooks', ['1']],
    ]);
  });
});

describe('recent items', () => {
  it('keeps the last opened entities first, de-duplicated and capped', () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_RECENTS + 2; i++) pushRecent(result('service', String(i)), store);
    pushRecent(result('service', '5'), store);

    const recents = readRecents(store);
    expect(recents).toHaveLength(MAX_RECENTS);
    expect(recents[0].id).toBe('5');
    expect(recents.filter(r => r.id === '5')).toHaveLength(1);
    expect(recents.map(r => r.id)).not.toContain('0');
  });

  it('ignores corrupt or unsafe stored data', () => {
    expect(readRecents(memoryStore({ [RECENTS_KEY]: '{not json' }))).toEqual([]);
    const tampered = JSON.stringify([
      { type: 'service', id: '1', title: 'ok', href: '/services/1' },
      { type: 'service', id: '2', title: 'bad', href: 'https://evil.example' },
      { type: 'nope', id: '3', title: 'x', href: '/x' },
    ]);
    expect(readRecents(memoryStore({ [RECENTS_KEY]: tampered })).map(r => r.id)).toEqual(['1']);
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readRecents(broken)).toEqual([]);
    expect(pushRecent(result('team', '1'), broken)).toHaveLength(1);
  });
});

describe('useEntitySearch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces typing into one request and aborts superseded ones', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender, result: hook } = renderHook(({ q }) => useEntitySearch(q), {
      initialProps: { q: 'da' },
    });
    rerender({ q: 'dat' });
    rerender({ q: 'data' });
    expect(hook.current.loading).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=data');

    rerender({ q: 'database' });
    expect(signals[0].aborted).toBe(true);
  });

  it('never shows a stale response under a newer query', async () => {
    vi.useFakeTimers();
    const pending = new Map<string, (r: SearchResult[]) => void>();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise(resolve => {
            pending.set(url, results =>
              resolve({ ok: true, json: async () => ({ results }) } as Response)
            );
          })
      )
    );

    const { rerender, result: hook } = renderHook(({ q }) => useEntitySearch(q), {
      initialProps: { q: 'api' },
    });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    rerender({ q: 'apis' });
    await act(async () => {
      pending.get('/api/search?q=api')?.([result('service', 'old')]);
    });
    expect(hook.current.results).toEqual([]);
    expect(hook.current.loading).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    await act(async () => {
      pending.get('/api/search?q=apis')?.([result('service', 'new')]);
    });
    expect(hook.current.loading).toBe(false);
    expect(hook.current.results.map(r => r.id)).toEqual(['new']);
  });

  it('does not search below two characters', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result: hook } = renderHook(() => useEntitySearch(' a '));
    expect(hook.current).toEqual({ results: [], loading: false, failed: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
