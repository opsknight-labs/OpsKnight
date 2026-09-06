import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dashboard query isolation contract', () => {
  const page = readFileSync('src/app/(app)/page.tsx', 'utf8');
  const operational = readFileSync('src/lib/dashboard/dashboard-operational-snapshot.ts', 'utf8');
  const wrapper = readFileSync('src/components/DashboardRealtimeWrapper.tsx', 'utf8');
  const incidentList = readFileSync('src/components/incident/IncidentsListTable.tsx', 'utf8');
  const analyticsProvider = readFileSync(
    'src/components/dashboard/DashboardAnalyticsProvider.tsx',
    'utf8'
  );
  const widgetProvider = readFileSync('src/lib/widget-data-provider.ts', 'utf8');

  it('never blocks dashboard SSR on the deep SLA engine', () => {
    expect(page).not.toContain('calculateActorSLAMetrics');
    expect(page).toContain('getDashboardOperationalSnapshot');
    expect(page).toContain('DashboardAnalyticsProvider');
  });

  it('keeps operational reads bounded and free of pause-history joins', () => {
    expect(operational).not.toContain('slaPauses:');
    expect(operational).not.toContain('calculateActorSLAMetrics');
    expect(operational).toContain('take: PREVIEW_LIMIT');
    expect(operational).toContain('take: RECENT_LIMIT');
    expect(operational).toContain('groupBy');
  });

  it('does not rely on a full route refresh for realtime updates', () => {
    expect(wrapper).not.toContain('router.refresh');
    expect(wrapper).not.toContain('useRouter');
    const realtimeEffect = incidentList.slice(
      incidentList.indexOf('// Real-time updates & newly incoming pulse tracking'),
      incidentList.indexOf('useEffect(() => {\n    if (focusedIndex')
    );
    expect(realtimeEffect).not.toContain('router.refresh');
  });

  it('does not poll historical analytics and keeps operational SLA reads materialized', () => {
    expect(analyticsProvider).not.toContain('setInterval');
    expect(widgetProvider).not.toContain('slaPauses:');
    expect(widgetProvider).toContain('effectiveMaterializedElapsedMs');
  });
});
