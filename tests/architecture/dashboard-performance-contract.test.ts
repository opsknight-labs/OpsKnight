import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dashboard query isolation contract', () => {
  const page = readFileSync('src/app/(app)/page.tsx', 'utf8');
  const live = readFileSync('src/lib/dashboard/live-incidents.ts', 'utf8');
  const incidentList = readFileSync('src/components/incident/IncidentsListTable.tsx', 'utf8');
  const analyticsProvider = readFileSync(
    'src/components/dashboard/DashboardAnalyticsProvider.tsx',
    'utf8'
  );
  const widgetProvider = readFileSync('src/lib/widget-data-provider.ts', 'utf8');
  const realtimeCache = readFileSync('src/lib/realtime-cache.ts', 'utf8');

  it('never blocks dashboard SSR on the deep SLA engine', () => {
    expect(page).not.toContain('calculateActorSLAMetrics');
    expect(page).toContain('getLiveDashboardSnapshot');
    expect(page).toContain('DashboardHistoryProvider');
    // Global full-table counts and the all-users directory are not part of the dashboard shell.
    expect(page).not.toContain('resolveAccessContext');
    expect(page).not.toContain('prisma.user.findMany');
  });

  it('keeps live reads bounded, shared per scope and free of pause-history joins', () => {
    expect(live).not.toContain('slaPauses:');
    expect(live).toContain('take: LIVE_SET_CAP + 1');
    expect(live).toContain('getCachedOrFetch(');
    expect(live).toMatch(/live-set:\$\{scope\.key\}:g:\$\{generation/);
  });

  it('does not rely on a full route refresh for realtime updates', () => {
    const realtimeEffect = incidentList.slice(
      incidentList.indexOf('// Real-time updates & newly incoming pulse tracking'),
      incidentList.indexOf('useEffect(() => {\n    if (focusedIndex')
    );
    expect(realtimeEffect).not.toContain('router.refresh');
  });

  it('does not poll historical analytics and keeps operational SLA reads materialized', () => {
    expect(analyticsProvider).not.toContain('setInterval');
    expect(widgetProvider).not.toContain('slaPauses:');
    expect(widgetProvider).toContain('projectIncidentSlaState');
    expect(widgetProvider).not.toContain('resolveSlaTarget');
  });

  it('keeps dashboard reconciliation filtered and realtime reads centrally authorized', () => {
    const recentFetcher = realtimeCache.slice(
      realtimeCache.indexOf('export async function getCachedRecentIncidents'),
      realtimeCache.indexOf('export async function getCachedServiceIncidents')
    );
    expect(recentFetcher).toContain('incidentReadWhere({');
    expect(recentFetcher).not.toContain('service: { team: { members:');
  });
});
