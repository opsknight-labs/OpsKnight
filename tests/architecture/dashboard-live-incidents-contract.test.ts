import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dashboard live incidents contract', () => {
  const page = readFileSync('src/app/(app)/page.tsx', 'utf8');
  const panel = readFileSync('src/components/dashboard/LiveIncidentsPanel.tsx', 'utf8');

  it('renders the live feed directly after the command center and before analytics', () => {
    const command = page.indexOf('<DashboardCommandCenter');
    const live = page.indexOf('<LiveIncidentsPanel');
    const pulse = page.indexOf('Ops Pulse');
    const sla = page.indexOf('<SLABreachAlertsWidget');
    const heatmap = page.indexOf('<DashboardAnalyticsHeatmap');
    expect(command).toBeGreaterThan(-1);
    expect(live).toBeGreaterThan(command);
    expect(pulse).toBeGreaterThan(live);
    expect(sla).toBeGreaterThan(pulse);
    expect(heatmap).toBeGreaterThan(sla);
  });

  it('never bounds rolling dashboard ranges by the page-load timestamp', () => {
    expect(page).toMatch(/createdBefore:\s*\n?\s*range === 'custom' && customEnd/);
  });

  it('uses the shared SSE connection only as an invalidation signal', () => {
    expect(panel).toContain('useRealtime()');
    expect(panel).not.toContain('new EventSource');
    expect(panel).not.toContain('router.refresh');
    expect(panel).not.toContain('recentIncidents');
    expect(panel).toContain('/api/dashboard/live-incidents');
  });
});
