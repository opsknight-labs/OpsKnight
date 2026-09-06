import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dashboard authorization contract', () => {
  it('routes dashboard pages and widget APIs through canonical authorization filters', () => {
    const page = readFileSync('src/app/(app)/page.tsx', 'utf8');
    const snapshot = readFileSync('src/lib/dashboard/dashboard-operational-snapshot.ts', 'utf8');
    const analyticsRoute = readFileSync('src/app/api/dashboard/analytics/route.ts', 'utf8');
    const dataRoute = readFileSync('src/app/api/widgets/data/route.ts', 'utf8');
    const streamRoute = readFileSync('src/app/api/widgets/stream/route.ts', 'utf8');

    expect(page).toContain('getDashboardOperationalSnapshot(actor');
    expect(page).toContain('serviceReadWhere(actor)');
    expect(page).toContain('dashboardUserReadWhere(actor)');
    expect(page).not.toContain('calculateActorSLAMetrics(');
    expect(snapshot).toContain('incidentReadWhere(actor)');
    expect(analyticsRoute).toContain('getCurrentAuthorizationActor()');
    expect(analyticsRoute).not.toContain("searchParams.get('userId')");
    expect(dataRoute).toContain('dashboardMetricsScope(actor)');
    expect(streamRoute).toContain('dashboardMetricsScope(actor)');
  });
});
