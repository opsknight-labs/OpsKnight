import { describe, expect, it } from 'vitest';
import { projectPublicBranding } from '@/lib/status-pages/branding';
import { publicUptimeGrade } from '@/lib/status-pages/presentation';
import { parsePublicStatusPageSnapshot } from '@/lib/status-pages/public-contract-schema';
import {
  serializePublicStatusIncident,
  type StatusPagePublicSettings,
} from '@/lib/status-page-public-data';

const iso = '2026-09-10T00:00:00.000Z';

function publicSettings(
  overrides: Partial<StatusPagePublicSettings> = {}
): StatusPagePublicSettings {
  return {
    showServices: true,
    showIncidents: true,
    showMetrics: true,
    showIncidentDetails: true,
    showIncidentTitles: true,
    showIncidentDescriptions: true,
    showAffectedServices: true,
    showIncidentTimestamps: true,
    showServiceMetrics: true,
    showServiceRegions: true,
    showServiceOwners: false,
    showServiceSlaTier: true,
    showTeamInformation: true,
    showIncidentUrgency: true,
    showUptimeHistory: true,
    showRecentIncidents: true,
    showPostIncidentReview: true,
    ...overrides,
  };
}

function validSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 3,
    pageId: 'page-1',
    revision: '7',
    generatedAt: iso,
    page: {
      id: 'page-1',
      name: 'Status',
      showSubscribe: true,
      showServicesByRegion: false,
      showRegionHeatmap: true,
      showPostIncidentReview: true,
      showChangelog: true,
      enableUptimeExports: false,
      isDefault: true,
      requireAuth: false,
      enabled: true,
      statusApiRequireToken: false,
      statusApiRateLimitEnabled: false,
      statusApiRateLimitMax: 120,
      statusApiRateLimitWindowSec: 60,
    },
    status: 'OPERATIONAL',
    services: [],
    regions: [],
    incidents: [],
    announcements: [],
    historyDays: 90,
    ...overrides,
  };
}

describe('V3 contract completion (PR2)', () => {
  it('normalizes legacy branding aliases into the typed shape', () => {
    expect(
      projectPublicBranding({ primary: '#112233', background: '#ffffff', logo: '/logo.png' })
    ).toEqual({ primaryColor: '#112233', backgroundColor: '#ffffff', logoUrl: '/logo.png' });
  });

  it('preserves layout, chrome, and refresh settings instead of dropping them', () => {
    expect(
      projectPublicBranding({
        layout: 'compact',
        showHeader: false,
        showFooter: false,
        autoRefresh: false,
        refreshInterval: 120,
        showApiLink: false,
        showRssLink: true,
      })
    ).toEqual({
      layout: 'compact',
      showHeader: false,
      showFooter: false,
      autoRefresh: false,
      refreshInterval: 120,
      showApiLink: false,
      showRssLink: true,
    });
  });

  it('grades uptime centrally and reports null measurements as ungraded', () => {
    const thresholds = { excellent: 99.9, good: 99 };
    expect(publicUptimeGrade(99.95, thresholds)).toBe('EXCELLENT');
    expect(publicUptimeGrade(99.5, thresholds)).toBe('GOOD');
    expect(publicUptimeGrade(98, thresholds)).toBe('BELOW_TARGET');
    expect(publicUptimeGrade(null, thresholds)).toBeUndefined();
  });

  it('accepts the new optional V3 sections and round-trips them', () => {
    const snapshot = parsePublicStatusPageSnapshot(
      'page-1',
      validSnapshot({
        page: {
          ...validSnapshot().page,
          branding: { primaryColor: '#000000', legacyExtra: 'kept' },
          capabilities: {
            services: true,
            serviceHistory: true,
            uptime: true,
            regions: true,
            incidents: true,
            incidentUpdates: true,
            postmortems: true,
            maintenance: true,
            announcements: true,
            changelog: true,
            subscriptions: true,
            rss: true,
            jsonApi: true,
            uptimeCsv: true,
            uptimePdf: true,
          },
          subscription: {
            enabled: true,
            channels: ['EMAIL'],
            verificationRequired: true,
            serviceSelectionSupported: false,
          },
        },
        maintenance: [
          {
            id: 'm1',
            title: 'DB upgrade',
            state: 'SCHEDULED',
            startAt: iso,
            endAt: null,
            affectedServices: [{ id: 's1', name: 'API' }],
          },
        ],
        retention: {
          requestedHistoryDays: 90,
          availableHistoryDays: 20,
          rangeStart: iso,
          rangeEnd: iso,
          coverage: 'PARTIAL',
        },
        freshness: { generatedAt: iso, revision: '7' },
      })
    );
    expect(snapshot?.maintenance?.[0]?.state).toBe('SCHEDULED');
    expect(snapshot?.retention?.availableHistoryDays).toBe(20);
    expect(snapshot?.freshness?.revision).toBe('7');
    expect(snapshot?.page.branding?.primaryColor).toBe('#000000');
    expect(snapshot?.page.capabilities?.uptime).toBe(true);
  });

  it('coerces canonical snapshot.status to overall.status and keeps UNKNOWN separately', () => {
    const snapshot = parsePublicStatusPageSnapshot(
      'page-1',
      validSnapshot({
        status: 'UNKNOWN',
        services: [
          { id: 'a', name: 'API', status: 'OPERATIONAL', activeIncidentCount: 0 },
          { id: 'b', name: 'DB', status: 'UNKNOWN', activeIncidentCount: 0 },
        ],
        overall: {
          status: 'OPERATIONAL',
          knownServiceCount: 1,
          unknownServiceCount: 1,
          confidence: 'partial',
          headline: 'All known systems operational',
          note: 'Status unavailable for 1 additional service.',
        },
      })
    );
    expect(snapshot?.status).toBe('OPERATIONAL');
    expect(snapshot?.overall.status).toBe('OPERATIONAL');
    expect(snapshot?.statusIncludingUnknown).toBe('UNKNOWN');
  });

  it('projects coarse public impact and a linkable postmortem without leaking internals', () => {
    const incident = serializePublicStatusIncident(
      {
        id: 'inc-1',
        title: 'Checkout errors',
        status: 'RESOLVED',
        urgency: 'HIGH',
        createdAt: iso,
        resolvedAt: iso,
        postmortem: {
          status: 'PUBLISHED',
          isPublic: true,
          title: 'RCA',
          summary: 'Root cause',
          publishedAt: iso,
        },
      },
      publicSettings()
    );
    expect(incident.publicImpact).toBe('MAJOR_OUTAGE');
    expect(incident.postmortem).toEqual({
      available: true,
      id: 'inc-1',
      publishedAt: iso,
      title: 'RCA',
      summary: 'Root cause',
    });
  });

  it('omits public impact and the postmortem id when disclosure is disabled', () => {
    const incident = serializePublicStatusIncident(
      {
        id: 'inc-1',
        title: 'Checkout errors',
        status: 'RESOLVED',
        urgency: 'HIGH',
        createdAt: iso,
        resolvedAt: iso,
        postmortem: { status: 'PUBLISHED', isPublic: true, title: 'RCA' },
      },
      publicSettings({ showIncidentUrgency: false, showIncidentDetails: false })
    );
    expect(incident.publicImpact).toBeUndefined();
    expect(incident.postmortem).toBeUndefined();
    expect(incident.postIncidentReview).toBe(true);
  });

  it('always attaches an opaque publicEventId when a page id is provided', () => {
    const incident = serializePublicStatusIncident(
      {
        id: 'inc-1',
        title: 'Checkout errors',
        status: 'OPEN',
        createdAt: iso,
        resolvedAt: null,
      },
      publicSettings({ showIncidentDetails: false, showIncidentTimestamps: false }),
      { pageId: 'page-1' }
    );
    expect(incident.id).toBeUndefined();
    expect(incident.createdAt).toBeUndefined();
    expect(incident.publicEventId).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(
      serializePublicStatusIncident(
        {
          id: 'inc-1',
          title: 'Checkout errors',
          status: 'OPEN',
          createdAt: iso,
          resolvedAt: null,
        },
        publicSettings({ showIncidentDetails: false }),
        { pageId: 'page-1' }
      ).publicEventId
    ).toBe(incident.publicEventId);
  });
});
