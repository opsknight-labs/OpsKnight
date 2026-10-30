import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIVE_QUERY, type LiveSnapshot } from '@/lib/dashboard/live-incidents-shared';

const realtime = vi.hoisted(() => ({
  value: {
    revision: 0,
    changeCount: 0,
    changeGeneration: null as string | null,
    connectionEpoch: 0,
    isConnected: true,
    lastMessageAt: Date.now(),
    isRevoked: false,
  },
}));
const publisher = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => realtime.value,
  useRealtimePublisher: () => publisher.publish,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import {
  LIVE_QUERY_STORAGE_PREFIX,
  LiveDashboardProvider,
  useLiveDashboard,
} from '@/components/dashboard/live/LiveDashboardProvider';

function snapshot(ids: string[], query = DEFAULT_LIVE_QUERY): LiveSnapshot {
  return {
    query,
    incidents: ids.map((id, index) => ({
      id,
      escalationLevel: null,
      alertCount: 0,
      responderCount: 0,
      title: id,
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      escalationStatus: null,
      createdAt: new Date(Date.UTC(2026, 9, 24, 12, 0, 59 - index)).toISOString(),
      updatedAt: '2026-10-24T12:00:00.000Z',
      service: { id: 'svc', name: 'API', teamId: null },
      team: null,
      assignee: null,
      sla: { warning: 'NONE', phase: null, deadline: null },
    })),
    total: ids.length,
    facets: {
      views: { active: 0, critical: 0, mine: 0, my_teams: 0, unassigned: 0, breaching: 0 },
      services: [],
      teams: [],
      status: { OPEN: 0, ACKNOWLEDGED: 0 },
      urgency: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      assignment: { assigned: 0, unassigned: 0 },
    },
    summary: {
      visibleActive: ids.length,
      active: ids.length,
      triggered: ids.length,
      acknowledged: 0,
      critical: 0,
      unassigned: 0,
      unassignedCritical: 0,
      slaBreached: 0,
      slaAtRisk: 0,
      slaDueSoon: 0,
      slaRecentlyBreached: 0,
      mine: 0,
    },
    pinned: [],
    attention: [],
    trend: {
      created: [],
      createdCritical: [],
      acknowledged: [],
      resolved: [],
      createdLastHour: 0,
      createdCriticalLastHour: 0,
      acknowledgedLastHour: 0,
      resolved24h: 0,
      mtta24h: null,
      mttr24h: null,
    },
    coverage: { me: { onCall: false, schedules: [], until: null }, gaps: [], scheduleCount: 0 },
    rail: { myQueue: [], slaRisk: [], servicesAtRisk: [], activity: [], onCall: [] },
    truncated: false,
    workingSet: ids.length,
    accuracy: { counters: 'exact', filtered: 'exact', sla: 'exact', trend: 'exact' },
    alerts: [],
    asOf: '2026-10-24T12:01:00.000Z',
    generation: '1',
  };
}

const holder: { current: ReturnType<typeof useLiveDashboard> | null } = { current: null };
function Probe() {
  const olderIds = useLiveDashboard()
    .olderIncidents.map(item => item.id)
    .join(',');
  const value = useLiveDashboard();
  useEffect(() => {
    holder.current = value;
  });
  const api = value;
  return (
    <div>
      <span data-testid="ids">{api.incidents.map(item => item.id).join(',')}</span>
      <span data-testid="pending">{api.pendingCount}</span>
      <span data-testid="older">{olderIds}</span>
      <span data-testid="can-older">{String(api.canLoadOlder)}</span>
      <span data-testid="highlighted">{[...api.highlighted].join(',')}</span>
    </div>
  );
}

// By default an answer reflects the newest generation a realtime signal has announced.
const respond = (
  body: LiveSnapshot,
  etag?: string,
  generation: string | null | undefined = realtime.value.changeGeneration
) =>
  Promise.resolve(
    new Response(JSON.stringify({ data: body }), {
      status: 200,
      headers: {
        ...(etag ? { ETag: etag } : {}),
        ...(generation ? { 'X-Live-Generation': generation } : {}),
      },
    })
  );
const notModified = (generation: string | null | undefined = realtime.value.changeGeneration) =>
  Promise.resolve(
    new Response(null, {
      status: 304,
      headers: generation ? { 'X-Live-Generation': generation } : undefined,
    })
  );

async function flush(ms = 400) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('LiveDashboardProvider', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    realtime.value = {
      ...realtime.value,
      revision: 0,
      changeCount: 0,
      changeGeneration: null,
      connectionEpoch: 0,
      isRevoked: false,
      lastMessageAt: Date.now(),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const mount = () =>
    render(
      <LiveDashboardProvider initialSnapshot={snapshot(['a'])} currentUserId="me">
        <Probe />
      </LiveDashboardProvider>
    );

  it('reconciles on a realtime change signal and highlights new rows', async () => {
    const view = mount();
    expect(screen.getByTestId('ids').textContent).toBe('a');
    fetchMock.mockImplementation(() => respond(snapshot(['b', 'a'])));
    realtime.value = { ...realtime.value, changeCount: 1, changeGeneration: '42' };
    view.rerender(
      <LiveDashboardProvider initialSnapshot={snapshot(['a'])} currentUserId="me">
        <Probe />
      </LiveDashboardProvider>
    );
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('after=42');
    expect(screen.getByTestId('ids').textContent).toBe('b,a');
    expect(screen.getByTestId('highlighted').textContent).toBe('b');
  });

  const rerenderProvider = (view: ReturnType<typeof mount>) =>
    view.rerender(
      <LiveDashboardProvider initialSnapshot={snapshot(['a'])} currentUserId="me">
        <Probe />
      </LiveDashboardProvider>
    );

  it('rate limits bursts of realtime signals to one read per gap without starving', async () => {
    const view = mount();
    fetchMock.mockImplementation(() => respond(snapshot(['a'])));
    realtime.value = { ...realtime.value, changeCount: 1, changeGeneration: '1' };
    rerenderProvider(view);
    await flush(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A steady stream of signals inside the gap collapses into exactly one follow-up read.
    for (let count = 2; count <= 12; count += 1) {
      realtime.value = { ...realtime.value, changeCount: count, changeGeneration: String(count) };
      rerenderProvider(view);
      await flush(40);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await flush(1_200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('after=');
    await flush(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores legacy revision bumps once change signals flow', async () => {
    const view = mount();
    fetchMock.mockImplementation(() => respond(snapshot(['a'])));
    realtime.value = { ...realtime.value, changeCount: 1, changeGeneration: '1' };
    rerenderProvider(view);
    await flush(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (let revision = 1; revision <= 5; revision += 1) {
      realtime.value = { ...realtime.value, revision };
      rerenderProvider(view);
    }
    await flush(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not read in a hidden tab and revalidates unchanged views with a 304', async () => {
    const view = mount();
    fetchMock
      .mockImplementationOnce(() => respond(snapshot(['a', 'b']), 'W/"v1"'))
      .mockImplementation(() => notModified());
    realtime.value = { ...realtime.value, changeCount: 1, changeGeneration: '1' };
    rerenderProvider(view);
    await flush(300);
    expect(screen.getByTestId('ids').textContent).toBe('a,b');

    realtime.value = { ...realtime.value, changeCount: 2, changeGeneration: '2' };
    rerenderProvider(view);
    await flush(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('W/"v1"');
    expect(screen.getByTestId('ids').textContent).toBe('a,b');

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      realtime.value = { ...realtime.value, changeCount: 3, changeGeneration: '3' };
      rerenderProvider(view);
      await flush(3_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      visibility.mockRestore();
    }
  });

  it('pages older incidents by keyset cursor, dedupes them and resets on a query change', async () => {
    const base = snapshot(['a', 'b']);
    render(
      <LiveDashboardProvider initialSnapshot={{ ...base, total: 40 }} currentUserId="me">
        <Probe />
      </LiveDashboardProvider>
    );
    expect(screen.getByTestId('can-older').textContent).toBe('true');
    const older = snapshot(['b', 'older-1', 'older-2']).incidents;
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { incidents: older, nextCursor: 'next' } }), {
          status: 200,
        })
      )
    );
    act(() => holder.current!.loadOlder());
    await flush();
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(url.pathname).toBe('/api/dashboard/live/page');
    // The cursor is a position derived from the last displayed row; nothing else is sent.
    const decoded = JSON.parse(
      atob(url.searchParams.get('cursor')!.replace(/-/g, '+').replace(/_/g, '/'))
    );
    expect(decoded[1]).toBe('b');
    expect(url.searchParams.get('limit')).toBe('25');
    // Rows already shown by the feed are not duplicated.
    expect(screen.getByTestId('older').textContent).toBe('older-1,older-2');

    // A superseded query discards the older rows.
    fetchMock.mockImplementation(() =>
      respond(snapshot(['crit'], { ...DEFAULT_LIVE_QUERY, view: 'critical' }))
    );
    act(() => holder.current!.setQuery({ view: 'critical' }));
    await flush();
    expect(screen.getByTestId('older').textContent).toBe('');
  });

  it('publishes critical alerts and the visible active count to console-wide consumers', async () => {
    publisher.publish.mockClear();
    const withAlerts = (ids: string[], visibleActive: number) => ({
      ...snapshot(['a']),
      alerts: snapshot(ids).incidents,
      summary: { ...snapshot(['a']).summary, visibleActive },
    });
    const view = render(
      <LiveDashboardProvider initialSnapshot={withAlerts(['c1', 'c2'], 7)} currentUserId="me">
        <Probe />
      </LiveDashboardProvider>
    );
    const first = publisher.publish.mock.calls.at(-1)![0];
    expect(first.activeIncidentCount).toBe(7);
    expect(first.recentIncidents.map((item: { id: string }) => item.id)).toEqual(['c1', 'c2']);

    // c1 leaves the critical set: it is announced once as RESOLVED so banners clear.
    fetchMock.mockImplementation(() => respond(withAlerts(['c2'], 6)));
    realtime.value = { ...realtime.value, changeCount: 1, changeGeneration: '5' };
    view.rerender(
      <LiveDashboardProvider initialSnapshot={withAlerts(['c1', 'c2'], 7)} currentUserId="me">
        <Probe />
      </LiveDashboardProvider>
    );
    await flush(400);
    const next = publisher.publish.mock.calls.at(-1)![0];
    expect(next.activeIncidentCount).toBe(6);
    expect(
      next.recentIncidents.map((item: { id: string; status: string }) => [item.id, item.status])
    ).toEqual([
      ['c2', 'OPEN'],
      ['c1', 'RESOLVED'],
    ]);

    view.unmount();
    expect(publisher.publish.mock.calls.at(-1)![0]).toBeNull();
  });

  describe('consistency and recovery', () => {
    const signal = (view: ReturnType<typeof mount>, count: number, generation: string) => {
      realtime.value = { ...realtime.value, changeCount: count, changeGeneration: generation };
      rerenderProvider(view);
    };

    it('catches up when a read reflects an older generation than a signal announced', async () => {
      const view = mount();
      fetchMock
        .mockImplementationOnce(() => respond(snapshot(['a']), 'W/"1"', '40'))
        .mockImplementationOnce(() => notModified('40'))
        .mockImplementation(() => respond(snapshot(['b', 'a']), 'W/"2"', '45'));
      signal(view, 1, '40');
      await flush(300);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Signal for 45; the first answer (a 304 from a lagging replica) still reflects 40.
      signal(view, 2, '45');
      // The one-second minimum read gap also includes up to 150ms of jitter. Advancing only
      // one second races that timer when the first read happened late in the initial 300ms.
      await flush(1_250);
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      if (fetchMock.mock.calls.length === 2) {
        expect(screen.getByTestId('ids').textContent).toBe('a');
        expect(holder.current!.catchingUp).toBe(true);
      }

      // The bounded catch-up read converges on the announced generation without a new signal.
      await flush(2_000);
      expect(screen.getByTestId('ids').textContent).toBe('b,a');
      expect(holder.current!.catchingUp).toBe(false);
      const calls = fetchMock.mock.calls.length;
      await flush(5_000);
      expect(fetchMock).toHaveBeenCalledTimes(calls);
    });

    it('gives up after a bounded number of catch-ups and reports stale instead of live', async () => {
      const view = mount();
      fetchMock.mockImplementation(() => respond(snapshot(['a']), undefined, '40'));
      signal(view, 1, '40');
      await flush(300);
      signal(view, 2, '99');
      await flush(30_000);
      // 1 initial + at most 4 catch-ups + the occasional 30s safety read; never a loop.
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(8);
      expect(holder.current!.health).toBe('stale');
    });

    it('never lets an older answer replace newer state', async () => {
      const view = mount();
      fetchMock
        .mockImplementationOnce(() => respond(snapshot(['new']), 'W/"n"', '50'))
        .mockImplementation(() => respond(snapshot(['old']), 'W/"o"', '44'));
      signal(view, 1, '50');
      await flush(300);
      expect(screen.getByTestId('ids').textContent).toBe('new');
      signal(view, 2, '51');
      await flush(1_500);
      expect(screen.getByTestId('ids').textContent).toBe('new');
    });

    it('keeps the last snapshot, backs off with jitter and recovers without a refresh', async () => {
      const view = mount();
      fetchMock.mockImplementation(() => Promise.reject(new Error('db down')));
      signal(view, 1, '10');
      await flush(300);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('ids').textContent).toBe('a');
      expect(holder.current!.syncError).toBe(true);
      expect(holder.current!.health).toBe('stale');
      // Backoff: 2.5-5s, then 5-10s, then 10-20s ... never a tight loop.
      await flush(5_100);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await flush(5_000);
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
      fetchMock.mockImplementation(() => respond(snapshot(['b', 'a']), undefined, '10'));
      await flush(21_000);
      expect(screen.getByTestId('ids').textContent).toBe('b,a');
      expect(holder.current!.syncError).toBe(false);
    });

    it('treats a hung request as a failure and does not block later reads', async () => {
      const view = mount();
      fetchMock
        .mockImplementationOnce(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
              );
            })
        )
        .mockImplementation(() => respond(snapshot(['b', 'a']), undefined, '11'));
      signal(view, 1, '11');
      await flush(300);
      await flush(15_500);
      expect(holder.current!.syncError).toBe(true);
      await flush(11_000);
      expect(screen.getByTestId('ids').textContent).toBe('b,a');
    });

    it('stops retrying on an authorization failure and clears sensitive state', async () => {
      const view = mount();
      fetchMock.mockImplementation(() => Promise.resolve(new Response('no', { status: 401 })));
      act(() => holder.current!.selectIncident('a'));
      signal(view, 1, '10');
      await flush(300);
      const liveReads = () =>
        fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/dashboard/live?'));
      expect(liveReads()).toHaveLength(1);
      expect(holder.current!.snapshot).toBeNull();
      expect(holder.current!.selectedIncidentId).toBeNull();
      await flush(120_000);
      expect(liveReads()).toHaveLength(1);
    });

    it('clears sensitive state when the realtime session is revoked', async () => {
      const view = mount();
      expect(holder.current!.snapshot).not.toBeNull();
      realtime.value = { ...realtime.value, isRevoked: true };
      rerenderProvider(view);
      await flush(50);
      expect(holder.current!.snapshot).toBeNull();
      expect(holder.current!.incidents).toEqual([]);
      expect(holder.current!.health).toBe('revoked');
    });
  });

  it('buffers updates while paused and applies them on resume', async () => {
    mount();
    act(() => holder.current!.togglePaused());
    fetchMock.mockImplementation(() => respond(snapshot(['c', 'a'])));
    act(() => holder.current!.refresh());
    await flush();
    expect(screen.getByTestId('ids').textContent).toBe('a');
    expect(screen.getByTestId('pending').textContent).toBe('1');
    act(() => holder.current!.togglePaused());
    expect(screen.getByTestId('ids').textContent).toBe('c,a');
    expect(screen.getByTestId('pending').textContent).toBe('0');
  });

  it('never renders a response for a superseded filter and persists the saved view', async () => {
    mount();
    let resolveStale: (value: Response) => void = () => {};
    fetchMock
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            resolveStale = resolve;
            init.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            );
          })
      )
      .mockImplementationOnce(() =>
        respond(snapshot(['crit'], { ...DEFAULT_LIVE_QUERY, view: 'critical' }))
      );
    act(() => holder.current!.setQuery({ view: 'mine' }));
    act(() => holder.current!.setQuery({ view: 'critical' }));
    await flush();
    resolveStale(new Response(JSON.stringify({ data: snapshot(['stale']) })));
    await flush();
    expect(screen.getByTestId('ids').textContent).toBe('crit');
    expect(String(fetchMock.mock.calls[1][0])).toContain('view=critical');
    expect(window.location.search).toBe('?lview=critical');
    expect(
      JSON.parse(window.localStorage.getItem(`${LIVE_QUERY_STORAGE_PREFIX}me`)!)
    ).toMatchObject({
      view: 'critical',
    });
  });

  it('re-fetches canonical state after every reconnect', async () => {
    const view = mount();
    fetchMock.mockImplementation(() => respond(snapshot(['a', 'missed'])));
    realtime.value = { ...realtime.value, connectionEpoch: 2 };
    view.rerender(
      <LiveDashboardProvider initialSnapshot={snapshot(['a'])} currentUserId="me">
        <Probe />
      </LiveDashboardProvider>
    );
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ids').textContent).toBe('a,missed');
  });

  it('restores the saved view when the URL has none', async () => {
    window.localStorage.setItem(
      `${LIVE_QUERY_STORAGE_PREFIX}me`,
      JSON.stringify({ ...DEFAULT_LIVE_QUERY, view: 'unassigned' })
    );
    fetchMock.mockImplementation(() =>
      respond(snapshot([], { ...DEFAULT_LIVE_QUERY, view: 'unassigned' }))
    );
    mount();
    await flush();
    expect(String(fetchMock.mock.calls[0][0])).toContain('view=unassigned');
    expect(holder.current!.query.view).toBe('unassigned');
  });
});
