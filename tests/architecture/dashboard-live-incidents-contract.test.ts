import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('dashboard live command contract', () => {
  const page = read('src/app/(app)/page.tsx');
  const provider = read('src/components/dashboard/live/LiveDashboardProvider.tsx');
  const liveFiles = [
    provider,
    read('src/components/dashboard/live/LiveIncidentsPanel.tsx'),
    read('src/components/dashboard/live/LiveCommandStrip.tsx'),
    read('src/components/dashboard/live/ResponderRail.tsx'),
    read('src/components/dashboard/live/LiveWallboard.tsx'),
  ];
  const wallboardPage = read('src/app/(kiosk)/wallboard/page.tsx');
  const kioskLayout = read('src/app/(kiosk)/layout.tsx');

  it('orders the page: command strip, live feed, services/activity, rail, then trends', () => {
    const order = [
      '<LiveCommandStrip',
      '<LiveIncidentsPanel',
      '<ServicesAtRiskCard',
      '<MyQueueCard',
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
    expect(provider).not.toContain('recentIncidents');
    expect(provider).toContain('/api/dashboard/live?');
    expect(provider).toContain("params.set('after'");
  });

  it('keeps live data independent from historical reporting dates', () => {
    const shared = read('src/lib/dashboard/live-incidents-shared.ts');
    const live = read('src/lib/dashboard/live-incidents.ts');
    expect(live).not.toMatch(/createdAt:\s*\{\s*(gte|lte)/);
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
