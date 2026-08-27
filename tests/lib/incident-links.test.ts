import { describe, expect, it } from 'vitest';
import { buildIncidentListHref } from '@/lib/incident-links';

describe('buildIncidentListHref', () => {
  it('builds supported desktop active and unassigned filters', () => {
    expect(buildIncidentListHref({ filter: 'all_open', assignee: 'unassigned' })).toBe(
      '/incidents?filter=all_open&assignee=unassigned'
    );
  });

  it('builds strict status drill-downs', () => {
    expect(buildIncidentListHref({ status: 'ACKNOWLEDGED' })).toBe(
      '/incidents?status=ACKNOWLEDGED'
    );
  });

  it('builds the combined muted incident drill-down', () => {
    expect(buildIncidentListHref({ filter: 'muted' })).toBe('/incidents?filter=muted');
  });

  it('supports mobile service drill-downs', () => {
    expect(
      buildIncidentListHref({ basePath: '/m/incidents', filter: 'all_open', serviceId: 'svc-1' })
    ).toBe('/m/incidents?filter=all_open&serviceId=svc-1');
  });

  it('preserves metric scope for historical drill-downs', () => {
    expect(
      buildIncidentListHref({
        filter: 'resolved',
        teamId: 'team-1',
        createdAfter: '2026-08-01T00:00:00.000Z',
        createdBefore: '2026-08-26T00:00:00.000Z',
      })
    ).toBe(
      '/incidents?filter=resolved&teamId=team-1&createdAfter=2026-08-01T00%3A00%3A00.000Z&createdBefore=2026-08-26T00%3A00%3A00.000Z'
    );
  });
});
