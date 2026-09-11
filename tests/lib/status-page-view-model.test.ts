import { describe, expect, it } from 'vitest';
import { createStatusPageViewModel } from '@/lib/status-pages/view-model';
import type { PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';

function snapshotWithIncident(
  incident: PublicStatusPageSnapshot['incidents'][number]
): PublicStatusPageSnapshot {
  return {
    schemaVersion: 3,
    pageId: 'page-1',
    revision: '1',
    generatedAt: '2026-09-10T00:00:00.000Z',
    page: {
      id: 'page-1',
      name: 'Status',
      showSubscribe: false,
      showServicesByRegion: false,
      showRegionHeatmap: false,
      showPostIncidentReview: true,
      showChangelog: false,
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
    incidents: [incident],
    announcements: [],
    historyDays: 90,
  } as PublicStatusPageSnapshot;
}

describe('status page legacy compatibility view model', () => {
  it('uses the opaque event id for rendering but does not fabricate a postmortem link', () => {
    const view = createStatusPageViewModel(
      { id: 'page-1', name: 'Status', showPostIncidentReview: true },
      snapshotWithIncident({
        publicEventId: 'evt_1234567890abcdef1234567890abcdef',
        status: 'RESOLVED',
        postIncidentReview: true,
      })
    );

    expect(view.incidents[0]?.id).toBe('evt_1234567890abcdef1234567890abcdef');
    expect(view.incidents[0]?.postIncidentReview).toBe(false);
  });

  it('keeps the postmortem link marker only when V3 supplied a real public postmortem id', () => {
    const view = createStatusPageViewModel(
      { id: 'page-1', name: 'Status', showPostIncidentReview: true },
      snapshotWithIncident({
        id: 'incident-1',
        publicEventId: 'evt_1234567890abcdef1234567890abcdef',
        status: 'RESOLVED',
        postIncidentReview: true,
        postmortem: { available: true, id: 'incident-1' },
      })
    );

    expect(view.incidents[0]?.id).toBe('incident-1');
    expect(view.incidents[0]?.postIncidentReview).toBe(true);
  });
});
