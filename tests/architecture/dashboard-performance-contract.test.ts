import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dashboard query isolation contract', () => {
  const page = readFileSync('src/app/(app)/page.tsx', 'utf8');
  const operational = readFileSync('src/lib/dashboard/dashboard-operational-snapshot.ts', 'utf8');
  const wrapper = readFileSync('src/components/DashboardRealtimeWrapper.tsx', 'utf8');

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
  });
});
