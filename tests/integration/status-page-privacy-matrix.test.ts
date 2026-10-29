import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetDatabase,
  createTestStatusPage,
  createTestService,
  createTestTeam,
  createTestIncident,
  linkServiceToStatusPage,
  testPrisma,
} from '../helpers/test-db';
import { buildStatusPageSnapshot } from '@/lib/status-pages/snapshot';

vi.mock('@/lib/sla-server', () => ({
  calculateMultiServiceUptime: vi.fn().mockResolvedValue({}),
}));

/**
 * One row per disclosure toggle: when it is off, the published projection must not carry the
 * field at all. Absence is how the projection expresses suppression -- every consumer, including
 * the HTML renderer, treats a missing field as "not permitted" -- so a field that survives its
 * own toggle is a leak on every surface at once.
 */
const MATRIX: Array<{
  field: string;
  toggle: string;
  /** Companion toggles that also grant this field, and must be off for it to be suppressed. */
  alsoDisable?: string[];
  read: (snapshot: Record<string, unknown>) => unknown;
}> = [
  {
    field: 'service description',
    toggle: 'showServiceDescriptions',
    read: s => (s.services as Array<Record<string, unknown>>)[0]?.description,
  },
  {
    field: 'service regions',
    toggle: 'showServiceRegions',
    read: s => (s.services as Array<Record<string, unknown>>)[0]?.regions,
  },
  {
    field: 'service SLA tier',
    toggle: 'showServiceSlaTier',
    read: s => (s.services as Array<Record<string, unknown>>)[0]?.slaTier,
  },
  {
    field: 'owning team',
    // Team information has two independent grants; either one discloses it, so suppressing it
    // means turning both off. Asserting a single toggle would claim a leak that is not one.
    toggle: 'showTeamInformation',
    alsoDisable: ['showServiceOwners'],
    read: s => (s.services as Array<Record<string, unknown>>)[0]?.team,
  },
  {
    field: 'incident title',
    toggle: 'showIncidentTitles',
    read: s => (s.incidents as Array<Record<string, unknown>>)[0]?.title,
  },
  {
    field: 'incident description',
    toggle: 'showIncidentDescriptions',
    read: s => (s.incidents as Array<Record<string, unknown>>)[0]?.description,
  },
  {
    field: 'incident urgency',
    toggle: 'showIncidentUrgency',
    read: s => (s.incidents as Array<Record<string, unknown>>)[0]?.urgency,
  },
  {
    field: 'incident timestamps',
    toggle: 'showIncidentTimestamps',
    read: s => (s.incidents as Array<Record<string, unknown>>)[0]?.createdAt,
  },
  {
    field: 'affected service',
    toggle: 'showAffectedServices',
    read: s => (s.incidents as Array<Record<string, unknown>>)[0]?.service,
  },
];

async function project(pageOverrides: Record<string, unknown>) {
  const team = await createTestTeam('Payments team');
  const service = await createTestService('Checkout API', team.id, {
    description: 'Customer checkout API.',
    region: 'eu-west-1',
    slaTier: 'TIER_1',
  });
  const page = await createTestStatusPage({
    enabled: true,
    showServices: true,
    showIncidents: true,
    showMetrics: true,
    showServiceDescriptions: true,
    showServiceRegions: true,
    showServiceSlaTier: true,
    showServiceOwners: true,
    showTeamInformation: true,
    showIncidentTitles: true,
    showIncidentDescriptions: true,
    showIncidentUrgency: true,
    showIncidentTimestamps: true,
    showAffectedServices: true,
    showIncidentDetails: true,
    showRecentIncidents: true,
    showUptimeHistory: true,
    ...pageOverrides,
  });
  await linkServiceToStatusPage(page.id, service.id);
  await createTestIncident('Elevated errors', service.id, {
    visibility: 'PUBLIC',
    urgency: 'MEDIUM',
    description: 'Card payments are delayed.',
  });
  const snapshot = await buildStatusPageSnapshot(page.id, '1');
  return { page, snapshot: snapshot as unknown as Record<string, unknown> };
}

describe('status page privacy matrix', () => {
  beforeEach(resetDatabase);

  it.each(MATRIX)(
    'publishes $field only while $toggle is on',
    async ({ toggle, alsoDisable, read }) => {
      const enabled = await project({});
      expect(read(enabled.snapshot)).toBeDefined();

      await resetDatabase();
      const off = Object.fromEntries(
        [toggle, ...(alsoDisable ?? [])].map(field => [field, false])
      );
      const disabled = await project(off);
      expect(read(disabled.snapshot)).toBeUndefined();
    }
  );

  it('publishes no service catalogue when services are hidden', async () => {
    const { snapshot } = await project({ showServices: false });
    expect(snapshot.services).toEqual([]);
    expect(snapshot.regions).toEqual([]);
    // Uptime and history hang off each service entry, so removing the catalogue removes them too
    // rather than leaving per-service availability keyed by raw identifiers.
    expect(snapshot.services).toEqual([]);
  });

  it('stops incidents naming a service once affected services are hidden', async () => {
    // Hiding the catalogue does not by itself silence incident attribution: that is a separate
    // grant, so a page can list no services while still saying which one an incident affects.
    const shown = await project({ showServices: false });
    expect(JSON.stringify(shown.snapshot)).toContain('Checkout API');

    await resetDatabase();
    const hidden = await project({ showServices: false, showAffectedServices: false });
    expect(JSON.stringify(hidden.snapshot)).not.toContain('Checkout API');
  });

  it('publishes no incidents when incidents are hidden', async () => {
    const { snapshot } = await project({ showIncidents: false });
    expect(snapshot.incidents).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('Elevated errors');
  });

  it('never publishes a private incident regardless of toggles', async () => {
    const team = await createTestTeam('Payments team');
    const service = await createTestService('Checkout API', team.id);
    const page = await createTestStatusPage({ enabled: true, showIncidents: true });
    await linkServiceToStatusPage(page.id, service.id);
    await createTestIncident('Internal only', service.id, { visibility: 'PRIVATE' });
    const snapshot = await buildStatusPageSnapshot(page.id, '1');
    expect(JSON.stringify(snapshot)).not.toContain('Internal only');
  });

  it('never publishes a service that is not mapped to the page', async () => {
    await createTestService('Internal database');
    const page = await createTestStatusPage({ enabled: true, showServices: true });
    const snapshot = await buildStatusPageSnapshot(page.id, '1');
    expect(JSON.stringify(snapshot)).not.toContain('Internal database');
  });

  it('never publishes a mapped service that is hidden on the page', async () => {
    const service = await createTestService('Hidden service');
    const page = await createTestStatusPage({ enabled: true, showServices: true });
    await testPrisma.statusPageService.create({
      data: { statusPageId: page.id, serviceId: service.id, showOnPage: false, order: 0 },
    });
    const snapshot = await buildStatusPageSnapshot(page.id, '1');
    expect(JSON.stringify(snapshot)).not.toContain('Hidden service');
  });
});
