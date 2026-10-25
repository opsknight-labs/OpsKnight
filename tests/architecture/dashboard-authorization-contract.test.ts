import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dashboard authorization contract', () => {
  it('routes dashboard pages and live/analytics APIs through canonical authorization filters', () => {
    const page = readFileSync('src/app/(app)/page.tsx', 'utf8');
    const live = readFileSync('src/lib/dashboard/live-incidents.ts', 'utf8');
    const liveRoute = readFileSync('src/app/api/dashboard/live/route.ts', 'utf8');
    const analyticsRoute = readFileSync('src/app/api/dashboard/analytics/route.ts', 'utf8');
    const dataRoute = readFileSync('src/app/api/widgets/data/route.ts', 'utf8');
    const streamRoute = readFileSync('src/app/api/widgets/stream/route.ts', 'utf8');

    expect(page).toContain('getLiveDashboardSnapshot(actor');
    expect(page).toContain('serviceReadWhere(actor)');
    expect(page).toContain('teamReadWhere(actor)');
    expect(page).not.toContain('calculateActorSLAMetrics(');
    // Every live read (incidents and activity) is derived from incidentReadWhere.
    expect(live).toContain('incidentReadWhere(actor)');
    expect(live).toContain('{ incident: scope.where }');
    // Live on-call and schedule coverage reads are scoped to scheduleReadWhere.
    expect(live).toContain('scheduleReadWhere(actor)');
    expect(live).toContain('{ where: scheduleWhere }');
    expect(liveRoute).toContain('getCurrentAuthorizationActor()');
    expect(liveRoute).toContain('.strict()');
    expect(analyticsRoute).toContain('getCurrentAuthorizationActor()');
    expect(analyticsRoute).not.toContain("searchParams.get('userId')");
    expect(dataRoute).toContain('dashboardMetricsScope(actor)');
    expect(streamRoute).toContain('dashboardMetricsScope(actor)');
  });
});
