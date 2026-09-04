import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pages = {
  incidents: readFileSync('src/app/(app)/incidents/page.tsx', 'utf8'),
  services: readFileSync('src/app/(app)/services/page.tsx', 'utf8'),
  analytics: readFileSync('src/app/(app)/analytics/page.tsx', 'utf8'),
  schedules: readFileSync('src/app/(app)/schedules/page.tsx', 'utf8'),
  actionItems: readFileSync('src/app/(app)/action-items/page.tsx', 'utf8'),
  postmortems: readFileSync('src/app/(app)/postmortems/page.tsx', 'utf8'),
  analyticsContent: readFileSync('src/components/analytics/AnalyticsContent.tsx', 'utf8'),
  dashboard: readFileSync('src/app/(app)/page.tsx', 'utf8'),
  mobileAnalytics: readFileSync('src/app/(mobile)/m/analytics/page.tsx', 'utf8'),
  mobileDashboard: readFileSync('src/app/(mobile)/m/page.tsx', 'utf8'),
  mobileIncidents: readFileSync('src/app/(mobile)/m/incidents/page.tsx', 'utf8'),
  mobileIncidentDetail: readFileSync('src/app/(mobile)/m/incidents/[id]/page.tsx', 'utf8'),
  mobileServices: readFileSync('src/app/(mobile)/m/services/page.tsx', 'utf8'),
  mobileServiceDetail: readFileSync('src/app/(mobile)/m/services/[id]/page.tsx', 'utf8'),
  mobileTeams: readFileSync('src/app/(mobile)/m/teams/page.tsx', 'utf8'),
  mobileLayout: readFileSync('src/app/(mobile)/m/layout.tsx', 'utf8'),
  serviceDetail: readFileSync('src/app/(app)/services/[id]/page.tsx', 'utf8'),
  executiveReport: readFileSync('src/app/(app)/reports/executive/page.tsx', 'utf8'),
};

describe('actor-scoped page read contract', () => {
  it.each([
    ['incidents', pages.incidents, 'incidentReadWhere(actor)'],
    ['services', pages.services, 'serviceReadWhere(actor)'],
    ['analytics', pages.analytics, 'serviceReadWhere(actor)'],
    ['schedules', pages.schedules, 'scheduleReadWhere(actor)'],
    ['action items', pages.actionItems, 'postmortemReadWhere(actor)'],
    ['postmortems', pages.postmortems, 'postmortemReadWhere(actor)'],
  ])('%s composes centralized authorization before querying', (_name, page, predicate) => {
    expect(page).toContain('getCurrentAuthorizationActor()');
    expect(page).toContain(predicate);
  });

  it('routes user-facing analytics through the actor-first metrics boundary', () => {
    for (const page of [
      pages.analyticsContent,
      pages.dashboard,
      pages.mobileAnalytics,
      pages.mobileDashboard,
      pages.executiveReport,
    ]) {
      expect(page).toContain('calculateActorSLAMetrics(');
    }
  });

  it.each([
    ['mobile incidents', pages.mobileIncidents, ['incidentReadWhere(actor)']],
    ['mobile incident detail', pages.mobileIncidentDetail, ['incidentReadWhere(actor)']],
    ['mobile services', pages.mobileServices, ['serviceReadWhere(actor)', 'incidentReadWhere(actor)']],
    ['mobile service detail', pages.mobileServiceDetail, ['serviceReadWhere(actor)', 'incidentReadWhere(actor)']],
    ['mobile teams', pages.mobileTeams, ['teamReadWhere(actor)', 'incidentReadWhere(actor)']],
    ['mobile layout', pages.mobileLayout, ['incidentReadWhere(actor)']],
    ['service detail', pages.serviceDetail, ['serviceReadWhere(actor)', 'incidentReadWhere(actor)']],
  ])('%s uses centralized actor scope for rows and counts', (_name, page, predicates) => {
    expect(page).toContain('getCurrentAuthorizationActor()');
    for (const predicate of predicates) expect(page).toContain(predicate);
  });

  it('keeps authenticated uptime behind the actor-aware boundary', () => {
    expect(pages.serviceDetail).toContain('calculateActorMultiServiceUptime(');
  });
});
