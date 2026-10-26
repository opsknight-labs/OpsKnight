import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dashboard live command contract', () => {
  const page = readFileSync('src/app/(app)/page.tsx', 'utf8');
  const provider = readFileSync('src/components/dashboard/live/LiveDashboardProvider.tsx', 'utf8');
  const liveFiles = [
    provider,
    readFileSync('src/components/dashboard/live/LiveIncidentsPanel.tsx', 'utf8'),
    readFileSync('src/components/dashboard/live/LiveCommandStrip.tsx', 'utf8'),
    readFileSync('src/components/dashboard/live/ResponderRail.tsx', 'utf8'),
    readFileSync('src/components/dashboard/live/LiveWallboard.tsx', 'utf8'),
  ];
  const wallboardPage = readFileSync('src/app/(kiosk)/wallboard/page.tsx', 'utf8');
  const kioskLayout = readFileSync('src/app/(kiosk)/layout.tsx', 'utf8');

  it('orders the page: command center, live feed beside Ops Pulse, then trends', () => {
    const order = [
      '<LiveCommandStrip',
      '<DashboardCockpit',
      '<LiveIncidentsPanel',
      '<OpsPulsePanel',
      '<DashboardHistorySection',
    ].map(marker => page.indexOf(marker));
    expect(order.every(index => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps one shared SSE connection and never refreshes the whole route', () => {
    for (const source of liveFiles) {
      expect(source).not.toContain('new EventSource');
      expect(source).not.toContain('router.refresh');
    }
    expect(page).not.toContain('WidgetProvider');
    expect(page).not.toContain('DashboardRefresh');
  });

  it('uses realtime only as an invalidation signal for the authorized read path', () => {
    expect(provider).toContain('useRealtime()');
    // It never consumes the legacy incident payload; it only publishes to console consumers.
    expect(provider).not.toMatch(/\{[^}]*recentIncidents[^}]*\}\s*=\s*useRealtime\(\)/);
    expect(provider).toContain('/api/dashboard/live?');
    expect(provider).toContain("params.set('after'");
  });

  it('negotiates the cheapest stream per route with exactly one provider', () => {
    const appLayout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    const hook = readFileSync('src/hooks/useRealtime.ts', 'utf8');
    const stream = readFileSync('src/app/api/realtime/stream/route.ts', 'utf8');
    expect(appLayout).toContain('<RouteAwareRealtimeProvider>');
    expect(appLayout).not.toContain('<RealtimeProvider>');
    expect(hook).toContain("pathname === '/' ? 'signal' : 'full'");
    expect(kioskLayout).toContain('<RealtimeProvider mode="signal">');
    // One EventSource construction site, closed before any reconnect or mode change.
    expect(hook.match(/new EventSource\(/g)).toHaveLength(1);
    expect(hook).toContain("mode === 'signal' ? '/api/realtime/stream?mode=signal'");
    // Signal subscribers never run the legacy projections.
    expect(stream).toContain("req.nextUrl.searchParams.get('mode') === 'signal'");
    expect(stream.indexOf('if (signalOnly)')).toBeLessThan(
      stream.indexOf('getCachedRecentIncidents(')
    );
  });

  it('keeps live data independent from historical reporting dates', () => {
    const shared = readFileSync('src/lib/dashboard/live-incidents-shared.ts', 'utf8');
    const live = readFileSync('src/lib/dashboard/live-incidents.ts', 'utf8');
    const activeSet = live.slice(
      live.indexOf('async function loadActiveSet('),
      live.indexOf('async function loadActivity(')
    );
    expect(activeSet.length).toBeGreaterThan(100);
    expect(activeSet).not.toMatch(/createdAt:\s*\{\s*(gte|lte)/);
    // Hero trends use a fixed rolling window, never the history range picker.
    expect(live).toContain('const TREND_WINDOW_MS = 24 * 60 * 60_000;');
    expect(live).not.toMatch(/parseHistoryRange|HISTORY_RANGES/);
    expect(shared).not.toContain('createdBefore');
    expect(page).not.toContain('createdBefore');
  });

  it('serves the wallboard from a chrome-free, authenticated kiosk route', () => {
    expect(kioskLayout).toContain('getRequestActorContext()');
    expect(kioskLayout).toContain('RealtimeProvider');
    expect(kioskLayout).not.toContain('Sidebar');
    expect(kioskLayout).not.toContain('GlobalIncidentBanner');
    expect(wallboardPage).toContain('getLiveDashboardSnapshot(actor');
    expect(wallboardPage).toContain('persistQuery={false}');
    expect(page).toContain("redirect(rest ? `/wallboard?${rest}` : '/wallboard')");
  });
});
