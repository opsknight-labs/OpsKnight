import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StatusPageV3 from '@/components/status-page/StatusPageV3';
import type {
  PublicStatusPageSnapshot,
  PublicStatusService,
} from '@/lib/status-pages/public-contract';
import { deriveOverallPublicHealth } from '@/lib/status-pages/status-presentation';
import { aggregatePublicRegions } from '@/lib/status-pages/history';

vi.mock('@/components/status-page/StatusPageSubscribe', () => ({ default: () => null }));

const service = (over: Partial<PublicStatusService> = {}): PublicStatusService => ({
  id: 'svc-1',
  name: 'Checkout API',
  status: 'OPERATIONAL',
  activeIncidentCount: 0,
  ...over,
});

function snapshotOf(services: PublicStatusService[], over: Partial<PublicStatusPageSnapshot> = {}) {
  return {
    schemaVersion: 3,
    pageId: 'page-1',
    revision: '4',
    generatedAt: '2026-09-09T18:00:00.000Z',
    page: {
      id: 'page-1',
      name: 'Acme status',
      showSubscribe: false,
      showServicesByRegion: false,
      showRegionHeatmap: false,
      showPostIncidentReview: false,
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
    overall: deriveOverallPublicHealth(services),
    thresholds: { uptimeExcellent: 99.9, uptimeGood: 99 },
    services,
    regions: aggregatePublicRegions(services),
    incidents: [],
    announcements: [],
    historyDays: 90,
    ...over,
  } as PublicStatusPageSnapshot;
}

describe('StatusPageV3', () => {
  it('summarises the page for a reader at a glance', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([service(), service({ id: 'svc-2', name: 'Payments' })])}
      />
    );
    expect(screen.getByText('All systems operational')).toBeInTheDocument();
    expect(screen.getByText('All published services are operating normally.')).toBeInTheDocument();
  });

  it('keeps a real outage visible while flagging unverified services', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([
          service({ status: 'MAJOR_OUTAGE' }),
          service({ id: 'svc-2', name: 'Search', status: 'UNKNOWN' }),
        ])}
      />
    );
    expect(
      screen.getByRole('heading', { name: 'One service is experiencing an outage' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('Outage').length).toBeGreaterThan(0);
    expect(screen.getByText(/Status unverified for 1 additional service/)).toBeInTheDocument();
  });

  it('distinguishes partial from major outage', () => {
    render(<StatusPageV3 snapshot={snapshotOf([service({ status: 'PARTIAL_OUTAGE' })])} />);
    expect(
      screen.getByRole('heading', { name: 'One service has limited availability' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('Limited availability').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('heading', { name: 'One service is experiencing an outage' })
    ).not.toBeInTheDocument();
  });

  it('filters services by search term', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([service(), service({ id: 'svc-2', name: 'Payments' })])}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Search services'), {
      target: { value: 'payments' },
    });
    expect(screen.getByText('Payments')).toBeInTheDocument();
    expect(screen.queryByText('Checkout API')).not.toBeInTheDocument();
  });

  it('lists affected services before operational ones', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([
          service({ id: 'svc-ok', name: 'Alpha API' }),
          service({ id: 'svc-down', name: 'Zeta Gateway', status: 'MAJOR_OUTAGE' }),
        ])}
      />
    );
    const names = screen.getAllByText(/Alpha API|Zeta Gateway/).map(node => node.textContent);
    expect(names.indexOf('Zeta Gateway')).toBeLessThan(names.indexOf('Alpha API'));
  });

  it('filters services by status', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([
          service(),
          service({ id: 'svc-2', name: 'Payments', status: 'DEGRADED' }),
        ])}
      />
    );
    fireEvent.change(screen.getByRole('combobox', { name: /filter by status/i }), {
      target: { value: 'issues' },
    });
    expect(screen.getByText('Payments')).toBeInTheDocument();
    expect(screen.queryByText('Checkout API')).not.toBeInTheDocument();
  });

  it('lets a reader group and ungroup services by region', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf(
          [
            service({ regions: ['eu-west-1'] }),
            service({ id: 'svc-2', name: 'Payments', regions: ['us-east-1'] }),
          ],
          { page: { ...snapshotOf([]).page, showServicesByRegion: true } }
        )}
      />
    );
    expect(screen.getByRole('heading', { name: 'eu-west-1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Group by region' }));
    expect(screen.queryByRole('heading', { name: 'eu-west-1' })).not.toBeInTheDocument();
    expect(screen.getByText('Checkout API')).toBeInTheDocument();
    expect(screen.getByText('Payments')).toBeInTheDocument();
  });

  it('lists a multi-region service once when grouping', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([service({ regions: ['eu-west-1', 'us-east-1', 'ap-south-1'] })], {
          page: { ...snapshotOf([]).page, showServicesByRegion: true },
        })}
      />
    );
    expect(screen.getAllByText('Checkout API')).toHaveLength(1);
    expect(screen.getByText('Multi-region')).toBeInTheDocument();
  });

  it('groups a single-region service under its own region', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([service({ regions: ['eu-west-1'] })], {
          page: { ...snapshotOf([]).page, showServicesByRegion: true },
        })}
      />
    );
    expect(screen.getAllByText('eu-west-1').length).toBeGreaterThan(0);
  });

  it('reports a short uptime window as data rather than as unavailable', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([
          service({
            uptime: {
              days30: { percentage: 99.998, incidentCount: 1, measuredDays: 20, complete: false },
              days90: { percentage: 99.994, incidentCount: 3, measuredDays: 20, complete: false },
            },
          }),
        ])}
      />
    );
    expect(screen.getByText('99.998%')).toBeInTheDocument();
    expect(screen.getAllByText(/20 days of available data/).length).toBeGreaterThan(0);
  });

  it('uses the published SLA grade instead of re-grading uptime', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([
          service({
            uptime: {
              days30: {
                percentage: 99.5,
                incidentCount: 0,
                measuredDays: 30,
                complete: true,
                grade: 'BELOW_TARGET',
              },
              days90: {
                percentage: 99.5,
                incidentCount: 0,
                measuredDays: 90,
                complete: true,
                grade: 'BELOW_TARGET',
              },
            },
          }),
        ])}
      />
    );
    expect(screen.getByText('Below SLA')).toBeInTheDocument();
  });

  it('summarises a region in words instead of six counters', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf(
          [
            service({ regions: ['eu-west-1'] }),
            service({ id: 'svc-2', name: 'Payments', regions: ['eu-west-1'], status: 'DEGRADED' }),
          ],
          { page: { ...snapshotOf([]).page, showRegionHeatmap: true } }
        )}
      />
    );
    expect(screen.getByRole('heading', { name: 'Regions' })).toBeInTheDocument();
    expect(screen.getByText(/2 services/)).toBeInTheDocument();
    expect(screen.getByText(/1 impacted/)).toBeInTheDocument();
  });

  it('says a region is healthy when it is', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([service({ regions: ['eu-west-1'] })], {
          page: { ...snapshotOf([]).page, showRegionHeatmap: true },
        })}
      />
    );
    expect(screen.getByText(/1 service · All systems healthy/)).toBeInTheDocument();
  });

  it('does not invent a service section when the V3 projection contains no services', () => {
    render(<StatusPageV3 snapshot={snapshotOf([])} />);
    expect(screen.queryByRole('heading', { name: 'Services' })).not.toBeInTheDocument();
  });

  it('explains an empty filter result', () => {
    render(<StatusPageV3 snapshot={snapshotOf([service()])} />);
    fireEvent.change(screen.getByPlaceholderText('Search services'), {
      target: { value: 'nothing matches this' },
    });
    expect(screen.getByText(/No services match your filters/)).toBeInTheDocument();
  });

  it('notes when it is serving the last verified update', () => {
    render(<StatusPageV3 snapshot={snapshotOf([service()])} stale />);
    expect(screen.getByRole('note')).toHaveTextContent('Showing the last verified status update.');
  });

  it('tells the reader which clock the page uses', () => {
    render(<StatusPageV3 snapshot={snapshotOf([service()])} />);
    expect(screen.getByText(/Times shown in your local time/)).toBeInTheDocument();
  });

  it('exposes owner and tier with labels a reader can interpret', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([
          service({ slaTier: 'TIER_1', team: { id: 'team-1', name: 'Payments team' } }),
        ])}
      />
    );
    expect(screen.getByText('Owned by Payments team')).toBeInTheDocument();
    expect(screen.getByText('Service tier: TIER_1')).toBeInTheDocument();
  });

  it('omits sections that the published visibility contract hides', () => {
    const snapshot = snapshotOf([service()], {
      page: {
        ...snapshotOf([]).page,
        visibility: {
          services: false,
          incidents: false,
          metrics: false,
          uptime: false,
          regions: false,
          changelog: false,
          subscribe: false,
        },
      },
    });
    render(<StatusPageV3 snapshot={snapshot} />);
    expect(screen.queryByRole('heading', { name: 'Services' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent incidents' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Uptime metrics' })).not.toBeInTheDocument();
  });

  it('renders published history days without requiring expansion', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([
          service({
            history: {
              rangeStart: '2026-06-12T00:00:00.000Z',
              rangeEnd: '2026-09-10T00:00:00.000Z',
              coverage: 'COMPLETE',
              segments: [],
            },
          }),
        ])}
      />
    );
    expect(document.querySelectorAll('.status-v3-history__day').length).toBeGreaterThan(80);
    expect(screen.queryByRole('button', { name: 'View 90-day history' })).not.toBeInTheDocument();
  });

  it('opens the 24-hour inspector when a history day is selected', () => {
    render(
      <StatusPageV3
        snapshot={snapshotOf([
          service({
            history: {
              rangeStart: '2026-09-09T00:00:00.000Z',
              rangeEnd: '2026-09-10T00:00:00.000Z',
              coverage: 'COMPLETE',
              segments: [],
            },
          }),
        ])}
      />
    );
    const cell = document.querySelector('.status-v3-history__day');
    expect(cell).not.toBeNull();
    fireEvent.click(cell as Element);
    expect(screen.getByText('24:00')).toBeInTheDocument();
  });
});
