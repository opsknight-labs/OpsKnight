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

  it('orders the page: command center, live feed beside Ops Pulse, responders, then trends', () => {
    const order = [
      '<LiveCommandStrip',
      '<DashboardCockpit',
      '<LiveIncidentsPanel',
      '<OpsPulsePanel',
      '<OnCallCard',
      '<ActivityCard',
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
    const shared = readFileSync('src/lib/dashboard/live-incidents-shared.ts', 'utf8');
    const live = readFileSync('src/lib/dashboard/live-incidents.ts', 'utf8');
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
