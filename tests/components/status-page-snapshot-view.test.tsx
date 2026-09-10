import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatusPageSnapshotView from '@/components/status-page/StatusPageSnapshotView';
import type { StatusPageSnapshot } from '@/lib/status-pages/snapshot';

vi.mock('@/components/status-page/StatusPageSubscribe', () => ({
  default: () => <div>Subscribe form</div>,
}));
vi.mock('@/components/status-page/StatusPageAutoRefresh', () => ({
  default: () => null,
}));

const snapshot: StatusPageSnapshot = {
  schemaVersion: 3,
  pageId: 'page-1',
  revision: '7',
  generatedAt: '2026-09-07T10:00:00.000Z',
  status: 'DEGRADED',
  overall: {
    status: 'DEGRADED',
    knownServiceCount: 1,
    unknownServiceCount: 0,
    confidence: 'complete',
    headline: 'Degraded performance',
    note: null,
  },
  page: {
    id: 'page-1',
    name: 'Acme status',
    showSubscribe: false,
    showServicesByRegion: false,
    showRegionHeatmap: false,
    showPostIncidentReview: true,
    showChangelog: true,
    enableUptimeExports: true,
    isDefault: true,
    requireAuth: false,
    enabled: true,
    statusApiRequireToken: false,
    statusApiRateLimitEnabled: false,
    statusApiRateLimitMax: 120,
    statusApiRateLimitWindowSec: 60,
  },
  services: [
    {
      id: 'service-1',
      name: 'Payments',
      description: 'Payment processing',
      regions: ['eu-west-1'],
      slaTier: 'TIER_1',
      team: { id: 'team-1', name: 'Payments team' },
      status: 'DEGRADED',
      activeIncidentCount: 1,
      uptime: {
        days30: { percentage: 99.95, incidentCount: 1, measuredDays: 30, complete: true },
        days90: { percentage: 99.95, incidentCount: 1, measuredDays: 90, complete: true },
      },
    },
  ],
  incidents: [
    {
      id: 'incident-1',
      title: 'Elevated errors',
      description: 'Card payments are delayed.',
      status: 'OPEN',
      urgency: 'HIGH',
      createdAt: '2026-09-07T09:00:00.000Z',
      service: { name: 'Payments', regions: ['eu-west-1'] },
    },
  ],
  regions: [
    {
      name: 'eu-west-1',
      status: 'DEGRADED',
      totalServices: 1,
      operationalServices: 0,
      degradedServices: 1,
      maintenanceServices: 0,
      partialOutageServices: 0,
      majorOutageServices: 0,
      unknownServices: 0,
      impactedServices: 1,
      serviceIds: ['service-1'],
    },
  ],
  announcements: [],
  historyDays: 30,
};

describe('StatusPageSnapshotView publication parity', () => {
  it('renders every field included by the canonical visibility serializer', () => {
    render(<StatusPageSnapshotView snapshot={snapshot} stale={false} />);

    expect(screen.getAllByText('Payment processing').length).toBeGreaterThan(0);
    expect(screen.getByText(/Service tier: TIER_1/)).toBeInTheDocument();
    expect(screen.getByText(/Owned by Payments team/)).toBeInTheDocument();
    expect(screen.getByText('Elevated errors')).toBeInTheDocument();
    expect(screen.getByText('Card payments are delayed.')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText(/Started/)).toBeInTheDocument();
    expect(screen.getAllByText('Payments').length).toBeGreaterThan(0);
  });

  it('does not reconstruct fields omitted by privacy projection', () => {
    render(
      <StatusPageSnapshotView
        snapshot={{
          ...snapshot,
          incidents: [{ status: 'OPEN' }],
          services: [
            { id: 'service-1', name: 'Payments', status: 'OPERATIONAL', activeIncidentCount: 0 },
          ],
        }}
        stale={false}
      />
    );

    expect(screen.queryByText('Elevated errors')).not.toBeInTheDocument();
    expect(screen.queryByText(/Affected service/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SLA tier/)).not.toBeInTheDocument();
  });

  it('honors region, changelog, post-incident review, and export settings', () => {
    render(
      <StatusPageSnapshotView
        snapshot={{
          ...snapshot,
          page: {
            ...snapshot.page,
            showServicesByRegion: true,
            showRegionHeatmap: true,
            showPostIncidentReview: true,
            showChangelog: true,
            enableUptimeExports: true,
          },
          incidents: [
            {
              ...snapshot.incidents[0],
              status: 'RESOLVED',
              postmortem: { available: true, title: 'Post-incident review' },
            },
          ],
          changelog: [
            {
              id: 'update-1',
              title: 'New edge region',
              message: 'Traffic is now served closer to customers.',
              publishedAt: '2026-09-07T08:00:00.000Z',
            },
          ],
        }}
        stale={false}
      />
    );

    expect(screen.getByRole('heading', { name: 'Regions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Changelog' })).toBeInTheDocument();
    expect(screen.getByText('New edge region')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Post-incident review' })).toHaveAttribute(
      'href',
      '/status/postmortems/incident-1'
    );
    expect(screen.getByRole('link', { name: 'Uptime CSV' })).toHaveAttribute(
      'href',
      '/api/status/uptime-export?format=csv'
    );
    expect(screen.getByRole('link', { name: 'Uptime PDF' })).toHaveAttribute(
      'href',
      '/api/status/uptime-export?format=pdf'
    );
  });

  it('honors header, footer, and changelog suppression from current page settings', () => {
    render(
      <StatusPageSnapshotView
        snapshot={{
          ...snapshot,
          page: {
            ...snapshot.page,
            name: 'Hidden chrome status',
            showChangelog: false,
            branding: { showHeader: false, showFooter: false },
          },
          changelog: [
            {
              id: 'update-1',
              title: 'Hidden update',
              message: 'Should not render.',
              publishedAt: '2026-09-07T08:00:00.000Z',
            },
          ],
        }}
        stale={false}
      />
    );

    expect(screen.queryByText('Hidden chrome status')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Changelog' })).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden update')).not.toBeInTheDocument();
    expect(screen.queryByText('Powered by OpsKnight')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Status resources' })).not.toBeInTheDocument();
  });
});
