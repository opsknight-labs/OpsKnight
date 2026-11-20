import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { EMPTY_HEALTH, type WorkspaceHealth } from '@/lib/status-bar';
import StatusBar, { type StatusBarProps } from '@/components/layout/StatusBar';

type FakeRealtime = {
  isConnected: boolean;
  isRevoked: boolean;
  connectionEpoch: number;
  changeGeneration: string | null;
};

let realtime: FakeRealtime | null;

let sidebarCollapsed: boolean | null = true;
vi.mock('@/contexts/SidebarContext', () => ({
  useOptionalSidebar: () => (sidebarCollapsed === null ? null : { isCollapsed: sidebarCollapsed }),
}));

vi.mock('@/hooks/useRealtime', () => ({
  useOptionalRealtime: () => realtime,
}));

const NOW = Date.parse('2026-11-20T10:00:00Z');

const props = (overrides: Partial<StatusBarProps> = {}): StatusBarProps => ({
  shifts: [
    {
      scheduleId: 'sched-1',
      scheduleName: 'Primary',
      start: '2026-11-20T08:00:00Z',
      end: '2026-11-20T18:00:00Z',
      endClamped: false,
    },
  ],
  counts: { assigned: 3, unacked: 1 },
  renderedAt: NOW,
  health: { ...EMPTY_HEALTH, awaitingAck: 3 },
  ...overrides,
});

const live = (): FakeRealtime => ({
  isConnected: true,
  isRevoked: false,
  connectionEpoch: 1,
  changeGeneration: '1',
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(NOW);
  realtime = live();
  sidebarCollapsed = true;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        my: { assigned: 5, unacked: 2 },
        health: { ...EMPTY_HEALTH, awaitingAck: 7, slaAtRisk: 2 },
      },
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('StatusBar', () => {
  it('renders the items with the right hrefs and makes no request on mount', () => {
    render(<StatusBar {...props()} />);
    expect(screen.getByRole('contentinfo', { name: 'Status bar' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /On call · Primary · until 18:00/ }).getAttribute('href')
    ).toBe('/schedules/sched-1');
    expect(
      screen
        .getByRole('link', { name: /My incidents: 3 assigned · 1 unacked/ })
        .getAttribute('href')
    ).toBe('/incidents?filter=mine');
    expect(screen.queryByRole('link', { name: /release notes/ })).toBeNull();
    expect(screen.queryByText('10:00 UTC')).toBeNull();
    expect(screen.queryByText('production', { exact: false })).toBeNull();
    expect(screen.getByRole('link', { name: /3 awaiting ack/ }).getAttribute('href')).toBe(
      '/incidents?status=OPEN'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never shows opsknight.com or the version; the sidebar footer owns them', () => {
    for (const collapsed of [true, false]) {
      sidebarCollapsed = collapsed;
      const { unmount } = render(<StatusBar {...props()} />);
      expect(screen.queryByText('opsknight.com')).toBeNull();
      expect(screen.queryByText('v2.1.2')).toBeNull();
      expect(screen.getByRole('contentinfo').className).toContain('status-bar');
      unmount();
    }
  });

  it('leads with on-call and my work, then the signals', () => {
    render(<StatusBar {...props()} />);
    const links = screen.getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/schedules/sched-1',
      '/incidents?filter=mine',
      '/incidents?status=OPEN',
    ]);
    expect(screen.queryByRole('button', { name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('hides every signal at zero, so a calm day shows only Live', () => {
    render(<StatusBar {...props({ health: EMPTY_HEALTH })} />);
    expect(screen.queryByText(/awaiting ack|SLA at risk|maintenance/)).toBeNull();
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('shows SLA risk (critical) and maintenance (neutral) with tooltips and hrefs', () => {
    const maintenance = {
      count: 1,
      serviceId: 'svc-1',
      serviceName: 'Payments',
      endsAt: '2026-01-01T12:00:00.000Z',
    };
    const { unmount } = render(
      <StatusBar
        {...props({ health: { ...EMPTY_HEALTH, awaitingAck: 1, slaAtRisk: 2, maintenance } })}
      />
    );
    const ack = screen.getByRole('link', { name: /1 incident is open and unacknowledged/ });
    expect(ack.className).toContain('text-status-elevated');
    const sla = screen.getByRole('link', { name: /2 SLA at risk/ });
    expect(sla.getAttribute('href')).toBe('/?view=breaching');
    expect(sla.className).toContain('text-status-critical');
    const maint = screen.getByRole('link', { name: /Payments in maintenance, ends/ });
    expect(maint.getAttribute('href')).toBe('/services/svc-1');
    expect(maint.className).not.toContain('text-status-');
    unmount();
    render(
      <StatusBar
        {...props({
          health: { ...EMPTY_HEALTH, maintenance: { ...maintenance, count: 3 } },
        })}
      />
    );
    expect(
      screen.getByRole('link', { name: /3 services in maintenance/ }).getAttribute('href')
    ).toBe('/services');
  });

  const withHealth = (health: Partial<WorkspaceHealth>) => (
    <StatusBar {...props({ health: { ...EMPTY_HEALTH, asOf: NOW, ...health } })} />
  );

  it('shows war room, status page, runbooks and ingestion only while active', () => {
    const { unmount } = render(withHealth({}));
    expect(screen.queryByText(/war room|Status page|runbook|Ingestion/i)).toBeNull();
    unmount();
    render(
      withHealth({
        warRooms: {
          count: 1,
          incidentId: 'inc-1',
          title: 'DB down',
          since: new Date(NOW - 12 * 60_000).toISOString(),
        },
        statusPage: { status: 'PARTIAL_OUTAGE', pageName: 'Main', more: 1, href: null },
        runbooksRunning: 2,
        ingestionDelayed: true,
      })
    );
    // Three highest-priority stay inline: war room, ingestion, status page. Runbooks overflow.
    const war = screen.getByRole('link', { name: /War room · DB down · 12m/ });
    expect(war.getAttribute('href')).toBe('/incidents/inc-1');
    expect(war.className).toContain('text-status-critical');
    expect(screen.getByRole('link', { name: /Ingestion delayed/ }).getAttribute('href')).toBe(
      '/settings/system/health'
    );
    // Non-admin status page has no link but keeps its accessible name.
    expect(screen.getByRole('group', { name: /Status page: Partial outage \+1/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /runbooks running/ })).toBeNull();
    expect(screen.getByRole('button', { name: '1 more active signals' })).toBeTruthy();
  });

  it('shows a coverage gap link', () => {
    render(withHealth({ coverageGap: { count: 1, scheduleId: 's1', scheduleName: 'Primary' } }));
    const link = screen.getByRole('link', { name: /Primary has no one on call/ });
    expect(link.getAttribute('href')).toBe('/schedules/s1');
    expect(link.className).toContain('text-status-critical');
  });

  it('collapses lower-priority signals into a +N popover listing them', async () => {
    render(
      withHealth({
        awaitingAck: 2,
        slaAtRisk: 1,
        runbooksRunning: 1,
        maintenance: {
          count: 1,
          serviceId: 's',
          serviceName: 'Pay',
          endsAt: new Date(NOW).toISOString(),
        },
        warRooms: { count: 2, incidentId: 'i', title: 'x', since: new Date(NOW).toISOString() },
      })
    );
    // 5 active, 3 inline: sla, warRoom, ack. Overflow: maintenance, runbooks.
    expect(screen.getByRole('link', { name: /1 SLA at risk/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /2 war rooms/ }).getAttribute('href')).toBe(
      '/incidents'
    );
    const more = screen.getByRole('button', { name: '2 more active signals' });
    expect(screen.queryByRole('link', { name: /1 runbook running/ })).toBeNull();
    await act(async () => more.click());
    expect(screen.getByRole('link', { name: /1 runbook running/ }).getAttribute('href')).toBe(
      '/runbooks/executions'
    );
    expect(screen.getByRole('link', { name: /Pay in maintenance/ })).toBeTruthy();
  });

  it('hides on-call with no rotation and my work when both counts are 0', () => {
    render(<StatusBar {...props({ shifts: [], counts: { assigned: 0, unacked: 0 } })} />);
    expect(screen.queryByText(/On call|Off call/)).toBeNull();
    expect(screen.queryByText(/assigned/)).toBeNull();
  });

  it('shows off call with the next shift', () => {
    render(
      <StatusBar
        {...props({
          shifts: [
            {
              scheduleId: 's2',
              scheduleName: 'Secondary',
              start: '2026-11-22T09:00:00Z',
              end: '2026-11-23T09:00:00Z',
              endClamped: false,
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Off call · next Sun 09:00')).toBeTruthy();
  });

  it('re-derives on-call at the shift end without polling', () => {
    render(<StatusBar {...props()} />);
    expect(screen.getByText(/On call · Primary/)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1_000);
    });
    expect(screen.queryByText(/On call · Primary/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [live(), 'Live'],
    [{ ...live(), isConnected: false }, 'Reconnecting…'],
    [{ ...live(), isConnected: false, connectionEpoch: 0 }, 'Connecting…'],
    [{ ...live(), isConnected: false, isRevoked: true }, 'Offline'],
    [null, 'Offline'],
  ])('shows each connection state (%#)', (state, label) => {
    realtime = state;
    render(<StatusBar {...props()} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('pulses only while reconnecting', () => {
    realtime = { ...live(), isConnected: false };
    const { container, rerender } = render(<StatusBar {...props()} />);
    expect(container.querySelector('.motion-safe\\:animate-pulse')).not.toBeNull();
    realtime = live();
    rerender(<StatusBar {...props()} />);
    expect(container.querySelector('.motion-safe\\:animate-pulse')).toBeNull();
  });

  it('announces connection changes, but not the first connect', () => {
    realtime = { ...live(), isConnected: false, connectionEpoch: 0 };
    const { rerender } = render(<StatusBar {...props()} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');

    realtime = live();
    rerender(<StatusBar {...props()} />);
    expect(region.textContent).toBe('');

    realtime = { ...live(), isConnected: false };
    rerender(<StatusBar {...props()} />);
    expect(region.textContent).toBe('Realtime updates: Reconnecting…');

    // A re-render without a state change keeps the same announcement.
    rerender(<StatusBar {...props()} />);
    expect(region.textContent).toBe('Realtime updates: Reconnecting…');

    realtime = live();
    rerender(<StatusBar {...props()} />);
    expect(region.textContent).toBe('Realtime updates: Live');
  });

  it('refreshes counts once, debounced, when the change generation moves', async () => {
    const { rerender } = render(<StatusBar {...props()} />);
    realtime = { ...live(), changeGeneration: '2' };
    rerender(<StatusBar {...props()} />);
    realtime = { ...live(), changeGeneration: '3' };
    rerender(<StatusBar {...props()} />);
    act(() => vi.advanceTimersByTime(2_000));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/status-bar');
    expect(screen.getByText(/5 assigned/)).toBeTruthy();
    expect(screen.getByText('7 awaiting ack')).toBeTruthy();
    expect(screen.getByText('2 SLA at risk')).toBeTruthy();
  });

  it('ignores the generation replayed on reconnect', () => {
    const { rerender } = render(<StatusBar {...props()} />);
    realtime = { ...live(), connectionEpoch: 2 };
    rerender(<StatusBar {...props()} />);
    act(() => vi.advanceTimersByTime(120_000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('polls every 60s only while realtime is down, and never while hidden', () => {
    realtime = { ...live(), isConnected: false };
    render(<StatusBar {...props()} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => vi.advanceTimersByTime(120_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
  });
});
