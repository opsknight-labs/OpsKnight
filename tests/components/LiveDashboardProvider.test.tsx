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
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => realtime.value }));
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
    countsExact: true,
    asOf: '2026-10-24T12:01:00.000Z',
    generation: '1',
  };
}

const holder: { current: ReturnType<typeof useLiveDashboard> | null } = { current: null };
function Probe() {
  const value = useLiveDashboard();
  useEffect(() => {
    holder.current = value;
  });
  const api = value;
  return (
    <div>
      <span data-testid="ids">{api.incidents.map(item => item.id).join(',')}</span>
      <span data-testid="pending">{api.pendingCount}</span>
      <span data-testid="highlighted">{[...api.highlighted].join(',')}</span>
    </div>
  );
}

const respond = (body: LiveSnapshot, etag?: string) =>
  Promise.resolve(
    new Response(JSON.stringify({ data: body }), {
      status: 200,
      headers: etag ? { ETag: etag } : undefined,
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
    realtime.value = { ...realtime.value, revision: 0, changeCount: 0, connectionEpoch: 0 };
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
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 304 })));
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
