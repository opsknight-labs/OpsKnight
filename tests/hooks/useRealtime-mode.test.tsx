import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';

const nav = vi.hoisted(() => ({ pathname: '/incidents' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/lib/client-auth-recovery', () => ({
  notifySessionExpired: vi.fn(),
  verifyClientSession: vi.fn().mockResolvedValue({ ok: true }),
  isTerminalSessionError: vi.fn().mockReturnValue(false),
}));

import {
  RouteAwareRealtimeProvider,
  useRealtime,
  useRealtimePublisher,
  type RealtimeProjection,
} from '@/hooks/useRealtime';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  static get open() {
    return FakeEventSource.instances.filter(source => !source.closed);
  }
}

let latest: ReturnType<typeof useRealtime> | null = null;
let publisher: ReturnType<typeof useRealtimePublisher> = null;
function Probe() {
  const value = useRealtime();
  const publish = useRealtimePublisher();
  useEffect(() => {
    latest = value;
    publisher = publish;
  });
  return (
    <div>
      <span data-testid="mode">{value.mode}</span>
      <span data-testid="count">{String(value.activeIncidentCount)}</span>
      <span data-testid="recent">
        {value.recentIncidents.map(item => String(item.id)).join(',')}
      </span>
    </div>
  );
}

const mount = () =>
  render(
    <RouteAwareRealtimeProvider>
      <Probe />
    </RouteAwareRealtimeProvider>
  );

describe('route-aware realtime provider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    nav.pathname = '/incidents';
    latest = null;
    publisher = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the full stream on regular screens and the signal-only stream on the dashboard', () => {
    const view = mount();
    expect(FakeEventSource.open.map(source => source.url)).toEqual(['/api/realtime/stream']);
    expect(screen.getByTestId('mode').textContent).toBe('full');

    nav.pathname = '/';
    view.rerender(
      <RouteAwareRealtimeProvider>
        <Probe />
      </RouteAwareRealtimeProvider>
    );
    // Exactly one stream is open, the previous one was closed first, and it asks for signals only.
    expect(FakeEventSource.open.map(source => source.url)).toEqual([
      '/api/realtime/stream?mode=signal',
    ]);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(screen.getByTestId('mode').textContent).toBe('signal');

    nav.pathname = '/services';
    view.rerender(
      <RouteAwareRealtimeProvider>
        <Probe />
      </RouteAwareRealtimeProvider>
    );
    expect(FakeEventSource.open.map(source => source.url)).toEqual(['/api/realtime/stream']);
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it('never leaks streams, listeners or reconnect timers across rapid mode changes', async () => {
    const view = mount();
    for (const pathname of ['/', '/incidents', '/', '/teams', '/']) {
      nav.pathname = pathname;
      view.rerender(
        <RouteAwareRealtimeProvider>
          <Probe />
        </RouteAwareRealtimeProvider>
      );
      expect(FakeEventSource.open).toHaveLength(1);
    }
    // An error on the live stream schedules exactly one reconnect.
    const current = FakeEventSource.open[0];
    await act(async () => {
      current.onerror?.();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(FakeEventSource.open).toHaveLength(1);
    expect(FakeEventSource.open[0]).not.toBe(current);
    view.unmount();
    expect(FakeEventSource.open).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.open).toHaveLength(0);
  });

  it('feeds console consumers from the screen projection only in signal mode', () => {
    nav.pathname = '/';
    mount();
    const stream = FakeEventSource.open[0];
    act(() => stream.emit({ type: 'incidents_updated', incidents: [{ id: 'legacy' }] }));
    expect(screen.getByTestId('recent').textContent).toBe('legacy');

    const projection: RealtimeProjection = {
      recentIncidents: [{ id: 'from-dashboard' }],
      activeIncidentCount: 12,
    };
    act(() => publisher!(projection));
    expect(screen.getByTestId('recent').textContent).toBe('from-dashboard');
    expect(screen.getByTestId('count').textContent).toBe('12');

    act(() => publisher!(null));
    expect(screen.getByTestId('count').textContent).toBe('null');
  });

  it('uses stream metrics for the active count in full mode and ignores published projections', () => {
    mount();
    const stream = FakeEventSource.open[0];
    act(() =>
      stream.emit({
        type: 'metrics_updated',
        metrics: { open: 1, acknowledged: 1, resolved24h: 0, highUrgency: 0, active: 9 },
      })
    );
    expect(screen.getByTestId('count').textContent).toBe('9');
    act(() => publisher!({ recentIncidents: [{ id: 'x' }], activeIncidentCount: 99 }));
    expect(screen.getByTestId('count').textContent).toBe('9');
    expect(screen.getByTestId('recent').textContent).toBe('');
  });

  it('stops for good when authorization is revoked, even across a mode change', () => {
    const view = mount();
    act(() => FakeEventSource.open[0].emit({ type: 'authorization_revoked' }));
    expect(latest!.isRevoked).toBe(true);
    nav.pathname = '/';
    view.rerender(
      <RouteAwareRealtimeProvider>
        <Probe />
      </RouteAwareRealtimeProvider>
    );
    expect(FakeEventSource.open).toHaveLength(0);
  });
});
