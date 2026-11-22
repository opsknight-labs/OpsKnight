import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createFakeBusinessServiceEngine } from '@/lib/business-services/__fixtures__/health';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { ImpactReason } from '@/lib/business-services/contract';
import ImpactTimeline from '@/components/business-service/ImpactTimeline';
import {
  DependenciesPanel,
  MembersPanel,
  OverviewIncidentCounts,
  OverviewKpis,
  StatusPagesPanel,
} from '@/components/business-service/OverviewPanels';
import { describeReason, memberStatuses, reasonIds } from '@/components/business-service/reasons';

vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));

const actor: AuthorizationActor = { id: 'u1', role: 'STAKEHOLDER', status: 'ACTIVE', teamIds: [] };
const DAY = 86_400_000;
const now = new Date('2026-11-22T12:00:00Z');
const window = { from: new Date(now.getTime() - 30 * DAY), to: now };

const reasons: ImpactReason[] = [
  { kind: 'DIRECT', status: 'PARTIAL_OUTAGE', incidentId: 'i1', serviceId: 'api', urgency: 'HIGH' },
  {
    kind: 'DEPENDENCY',
    status: 'DEGRADED',
    incidentId: 'i2',
    serviceId: 'db',
    viaServiceId: 'web',
    depth: 2,
  },
  {
    kind: 'NESTED',
    status: 'MAJOR_OUTAGE',
    childBusinessServiceId: 'payments',
    depth: 1,
    incidentId: 'i3',
  },
];

const { engine } = createFakeBusinessServiceEngine({
  services: [
    { id: 'checkout', name: 'Checkout', criticality: 'TIER_0', ownerTeam: null, memberCount: 3 },
  ],
  timeline: {
    checkout: [
      {
        incidentId: 'i1',
        incidentTitle: 'Card auth failing for EU customers',
        urgency: 'HIGH',
        source: 'DIRECT',
        excluded: false,
        startedAt: new Date(now.getTime() - 2 * DAY),
        endedAt: new Date(now.getTime() - 2 * DAY + 90 * 60_000),
      },
      {
        incidentId: 'i9',
        incidentTitle: 'Old outage',
        urgency: 'LOW',
        source: 'MANUAL',
        excluded: true,
        startedAt: new Date(now.getTime() - 60 * DAY),
        endedAt: new Date(now.getTime() - 59 * DAY),
      },
    ],
  },
  stats: {
    checkout: { uptimePercent: 99.79, incidentCount: 3, mttaMinutes: 4, mttrMinutes: 95 },
  },
});

describe('business-service overview', () => {
  it('explains the status in plain sentences, without incident titles', () => {
    const names = {
      services: new Map([
        ['api', 'Checkout API'],
        ['web', 'Storefront'],
      ]),
      businessServices: new Map([['payments', 'Payments']]),
    };
    expect(reasons.map(reason => describeReason(reason, names))).toEqual([
      'Checkout API has an open high-urgency incident.',
      'Storefront depends on a service, which has an open incident.',
      'Payments is major outage.',
    ]);
    expect(reasonIds(reasons)).toEqual({
      services: ['api', 'db', 'web'],
      businessServices: ['payments'],
    });
  });

  it('shows each member with its own status and whether it drives health', () => {
    const statuses = memberStatuses(reasons);
    expect(Object.fromEntries(statuses)).toEqual({ api: 'PARTIAL_OUTAGE', web: 'DEGRADED' });
    render(
      <MembersPanel
        members={[
          {
            id: 'api',
            name: 'Checkout API',
            critical: true,
            teamName: 'Payments',
            canOpen: true,
            status: statuses.get('api') ?? null,
          },
          {
            id: 'cdn',
            name: 'CDN',
            critical: false,
            teamName: null,
            canOpen: false,
            status: 'OPERATIONAL',
          },
        ]}
        supporting={[{ id: 'payments', name: 'Payments', criticality: 'TIER_1', status: null }]}
      />
    );
    const api = screen.getByRole('row', { name: /Checkout API/ });
    expect(within(api).getByText('Partial outage')).toBeInTheDocument();
    expect(within(api).getByText('Critical')).toBeInTheDocument();
    expect(within(api).getByRole('link', { name: 'Checkout API' })).toHaveAttribute(
      'href',
      '/services/api'
    );
    const cdn = screen.getByRole('row', { name: /CDN/ });
    expect(within(cdn).getByText('Non-critical')).toBeInTheDocument();
    expect(within(cdn).queryByRole('link')).toBeNull();
    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute(
      'href',
      '/services/business/payments'
    );
    expect(screen.getByText('Status unavailable')).toBeInTheDocument();
  });

  it('renders uptime 30/90 d, incidents, MTTA and MTTR from the engine stats', async () => {
    const last90Window = { from: new Date(now.getTime() - 90 * DAY), to: now };
    const [last30, last90] = await Promise.all([
      engine.getBusinessServiceStats('checkout', window, actor),
      engine.getBusinessServiceStats('checkout', last90Window, actor),
    ]);
    render(<OverviewKpis last30={last30} last90={last90} />);
    const kpis = screen.getByRole('list', { name: 'Key metrics' });
    expect(kpis).toHaveTextContent('Uptime, 30 days99.79%');
    expect(kpis).toHaveTextContent('90 days: 99.79%');
    expect(kpis).toHaveTextContent('Incidents, 30 days3');
    expect(kpis).toHaveTextContent('MTTA4m');
    expect(kpis).toHaveTextContent('MTTR1.6h');
  });

  it('keeps incident titles out of the impact timeline for stakeholders', async () => {
    const entries = await engine.getImpactTimeline('checkout', window, actor);
    expect(entries).toHaveLength(1);
    const { rerender } = render(
      <ImpactTimeline entries={entries} window={window} showIncidents={false} />
    );
    expect(screen.getByRole('img', { name: '1 impact in the last 30 days' })).toBeInTheDocument();
    expect(screen.queryByText(/Card auth failing/)).toBeNull();
    expect(screen.getByRole('list', { name: 'Recent impacts' })).toHaveTextContent(
      'Incident · Direct'
    );
    rerender(<ImpactTimeline entries={entries} window={window} showIncidents />);
    expect(
      screen.getByRole('link', { name: 'Card auth failing for EU customers' })
    ).toHaveAttribute('href', '/incidents/i1');
  });

  it('renders an interval whose incident is withheld without a title or link', () => {
    render(
      <ImpactTimeline
        window={window}
        showIncidents
        entries={[
          {
            incidentId: null,
            incidentTitle: null,
            urgency: null,
            source: 'DEPENDENCY',
            excluded: false,
            startedAt: new Date(now.getTime() - DAY),
            endedAt: new Date(now.getTime() - DAY + 30 * 60_000),
          },
        ]}
      />
    );
    const list = screen.getByRole('list', { name: 'Recent impacts' });
    expect(list).toHaveTextContent('Incident · Via a dependency');
    expect(within(list).queryByRole('link')).toBeNull();
  });

  it('shows stakeholders incident counts only', () => {
    render(<OverviewIncidentCounts open={2} last30={5} />);
    expect(screen.getByText('Open incidents').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('Incidents, 30 days').nextSibling).toHaveTextContent('5');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('lists dependencies both ways and upstream technical services', () => {
    render(
      <DependenciesPanel
        businessServiceId="checkout"
        supporting={[
          { id: 'payments', name: 'Payments', criticality: null, status: 'OPERATIONAL' },
        ]}
        dependents={[]}
        technical={[{ id: 'db', name: 'Postgres', usedBy: ['Checkout API', 'Storefront'] }]}
      />
    );
    expect(
      screen.getByRole('list', { name: 'Business services this one depends on' })
    ).toHaveTextContent('Payments');
    expect(screen.getByText('No other business service relies on this one.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Upstream services' })).toHaveTextContent(
      'Postgresused by Checkout API, Storefront'
    );
  });

  it('shows status page placement, overrides and an empty state', () => {
    const { rerender } = render(
      <StatusPagesPanel
        canManage
        pages={[
          {
            id: 'l1',
            pageId: 'p1',
            name: 'Public status',
            href: '/status',
            displayName: 'Online checkout',
            showOnPage: true,
            showMembers: false,
            grouped: true,
            override: 'DEGRADED',
            overrideUntil: new Date(now.getTime() + DAY),
          },
        ]}
      />
    );
    const row = screen.getByRole('row', { name: /Public status/ });
    expect(row).toHaveTextContent('Online checkout');
    expect(row).toHaveTextContent('Component group, services hidden');
    expect(within(row).getByText('Degraded')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /Configure/ })).toHaveAttribute(
      'href',
      '/settings/status-pages/p1'
    );
    rerender(<StatusPagesPanel canManage={false} pages={[]} />);
    expect(screen.getByText('Not on a status page')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
