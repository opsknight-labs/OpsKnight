import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(app)/services/[id]/intelligence/actions', () => ({
  reviewServiceDependencyAction: vi.fn(async () => null),
}));
vi.mock('@/app/(app)/settings/intelligence/response/actions', () => ({
  createNoisyAlertIssueAction: vi.fn(async () => ({ message: '', ok: true })),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/services/svc-1',
  useSearchParams: () => new URLSearchParams(),
}));

import AiopsPulseTile from '@/components/dashboard/live/AiopsPulseTile';
import WallboardLargestGroupTile from '@/components/dashboard/live/WallboardLargestGroupTile';
import ServiceIntelligenceBadges from '@/components/service/ServiceIntelligenceBadges';
import ServiceDetailTabs from '@/components/service/ServiceDetailTabs';
import TeamIntelligenceTiles from '@/components/teams/TeamIntelligenceTiles';
import {
  AlertQualityPanel,
  AutoGatePanel,
  ChangesPanel,
  DependenciesPanel,
  LearnedFactsPanel,
  NoiseStatusPanel,
  RecurringProblemsPanel,
  SloBurnPanel,
} from '@/components/service/intelligence/ServiceIntelligencePanels';
import { GRAPH_MAX_PER_SIDE } from '@/components/service/intelligence/ServiceDependencyGraph';
import type {
  ServiceDependencyNeighbourhood,
  ServiceNoiseStatus,
} from '@/lib/intelligence/surfaces/service-intelligence';

const node = (id: string, name: string, openIncidents = 0) => ({
  id,
  name,
  openIncidents,
  highestOpenUrgency: openIncidents > 0 ? ('HIGH' as const) : null,
});

const neighbourhood: ServiceDependencyNeighbourhood = {
  focus: node('svc-1', 'Checkout'),
  neighbours: [node('svc-2', 'Payments', 2), node('svc-3', 'Ledger'), node('svc-4', 'Storefront')],
  edges: [
    {
      id: 'e1',
      direction: 'UPSTREAM',
      neighbourId: 'svc-2',
      origin: 'DECLARED',
      status: 'ACTIVE',
      confidence: 1,
    },
    {
      id: 'e2',
      direction: 'UPSTREAM',
      neighbourId: 'svc-3',
      origin: 'OBSERVED',
      status: 'SUGGESTED',
      confidence: 0.72,
    },
    {
      id: 'e3',
      direction: 'DOWNSTREAM',
      neighbourId: 'svc-4',
      origin: 'DECLARED',
      status: 'ACTIVE',
      confidence: 1,
    },
  ],
  truncated: false,
};

describe('ServiceIntelligenceBadges', () => {
  it('renders nothing without badges', () => {
    const { container, rerender } = render(<ServiceIntelligenceBadges serviceId="s" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ServiceIntelligenceBadges serviceId="s" badges={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels each badge in words', () => {
    render(
      <ServiceIntelligenceBadges
        serviceId="s"
        badges={{
          maintenance: { name: 'DB upgrade', endsAt: '2026-11-10T12:00:00.000Z' },
          sloBurning: 'critical',
          noiseMode: 'SHADOW',
        }}
      />
    );
    expect(screen.getByText('In maintenance')).toHaveAttribute(
      'title',
      'Maintenance window: DB upgrade'
    );
    expect(screen.getByText('SLO burning fast')).toBeInTheDocument();
    expect(screen.getByText('Noise controls: shadow')).toBeInTheDocument();
  });

  it('shows only the badges that apply', () => {
    render(<ServiceIntelligenceBadges serviceId="s" badges={{ noiseMode: 'ON' }} />);
    expect(screen.getByText('Noise controls on')).toBeInTheDocument();
    expect(screen.queryByText(/SLO burning/)).not.toBeInTheDocument();
    expect(screen.queryByText('In maintenance')).not.toBeInTheDocument();
  });
});

describe('AiopsPulseTile', () => {
  const pulse = {
    windowHours: 24,
    pagesAvoided: 1234,
    openGroups: 2,
    triageAwaitingReview: 0,
    quarantinedWork: null,
  };

  it('renders nothing without a pulse or when every number is zero', () => {
    const { container, rerender } = render(<AiopsPulseTile pulse={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AiopsPulseTile pulse={{ ...pulse, pagesAvoided: 0, openGroups: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists only non-zero numbers and links to the overview', () => {
    render(<AiopsPulseTile pulse={pulse} />);
    const link = screen.getByRole('link', { name: /AIOps pulse/ });
    expect(link).toHaveAttribute('href', '/intelligence');
    expect(within(link).getByText('Pages avoided · 24 h')).toBeInTheDocument();
    expect(within(link).getByText('999+')).toBeInTheDocument();
    expect(within(link).getByText('Open groups')).toBeInTheDocument();
    expect(within(link).queryByText('Triage to review')).not.toBeInTheDocument();
    expect(within(link).queryByText('Quarantined work')).not.toBeInTheDocument();
  });

  it('shows quarantined work when the server sent it', () => {
    render(<AiopsPulseTile pulse={{ ...pulse, triageAwaitingReview: 4, quarantinedWork: 3 }} />);
    expect(screen.getByText('Triage to review')).toBeInTheDocument();
    expect(screen.getByText('Quarantined work')).toBeInTheDocument();
  });
});

describe('WallboardLargestGroupTile', () => {
  it('renders nothing when no group is open', () => {
    const { container } = render(<WallboardLargestGroupTile group={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the parent and counts its grouped incidents', () => {
    render(
      <WallboardLargestGroupTile
        group={{
          parentId: 'inc-1',
          parentRef: '#INC-1',
          parentTitle: 'Checkout storm',
          serviceName: 'Checkout',
          childCount: 7,
        }}
      />
    );
    expect(screen.getByRole('heading', { name: 'Largest open group' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Checkout storm' })).toHaveAttribute(
      'href',
      '/incidents/inc-1'
    );
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('grouped incidents')).toBeInTheDocument();
    expect(screen.getByText('#INC-1 · Checkout')).toBeInTheDocument();
  });
});

describe('TeamIntelligenceTiles', () => {
  const aiUsage = {
    todayTokens: 250,
    todayCostMicros: 2_500_000,
    dailyTokenLimit: 1000,
    dailyCostLimitMicros: null,
    utilization: 0.85,
    hasBudget: true,
    days: 7,
    periodTokens: 900,
    periodCostMicros: 9_000_000,
  };
  const noiseLoad = {
    days: 7,
    services: 3,
    alerts: 120,
    incidents: 30,
    compressionRatio: 4,
    pagesAvoided: 12,
    shadowWouldAvoid: 5,
  };

  it('renders nothing when both tiles are silent', () => {
    const { container, rerender } = render(<TeamIntelligenceTiles tiles={null} canManage />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TeamIntelligenceTiles tiles={{ aiUsage: null, noiseLoad: null }} canManage />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows AI usage against the budget and the noise load', () => {
    render(<TeamIntelligenceTiles tiles={{ aiUsage, noiseLoad }} canManage />);
    const usage = screen.getByTestId('team-ai-usage');
    expect(within(usage).getByText('85%')).toBeInTheDocument();
    expect(within(usage).getByText('Close to budget')).toBeInTheDocument();
    expect(within(usage).getByText(/of 1,000 tokens a day/)).toBeInTheDocument();
    expect(within(usage).getByRole('link', { name: 'Spend and budgets' })).toHaveAttribute(
      'href',
      '/settings/intelligence/evaluation#ai-spend'
    );
    const noise = screen.getByTestId('team-noise-load');
    expect(within(noise).getByText('120')).toBeInTheDocument();
    expect(within(noise).getByText('4× alerts per incident')).toBeInTheDocument();
    expect(within(noise).getByText('+5 in shadow')).toBeInTheDocument();
  });

  it('omits the budget meter and the settings link when they do not apply', () => {
    render(
      <TeamIntelligenceTiles
        tiles={{
          aiUsage: { ...aiUsage, hasBudget: false, dailyTokenLimit: null, utilization: 0 },
          noiseLoad: null,
        }}
        canManage={false}
      />
    );
    expect(screen.getByText(/No daily budget set/)).toBeInTheDocument();
    expect(screen.queryByText('Daily budget used')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Spend and budgets' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-noise-load')).not.toBeInTheDocument();
  });
});

describe('service Intelligence panels', () => {
  it('lists dependencies and offers review of suggestions to a manager only', () => {
    const { rerender, container } = render(<DependenciesPanel data={neighbourhood} canManage />);
    const active = screen.getByRole('list', { name: 'Dependencies' });
    expect(within(active).getByRole('link', { name: 'Payments' })).toHaveAttribute(
      'href',
      '/services/svc-2?tab=intelligence'
    );
    expect(within(active).getByText(/2 open incidents/)).toBeInTheDocument();
    const suggested = screen.getByRole('list', { name: 'Suggested dependencies' });
    expect(within(suggested).getByText('Checkout depends on Ledger')).toBeInTheDocument();
    expect(within(suggested).getByText(/Suggested · 72% confidence/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Approve suggested dependency: Checkout depends on Ledger',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Reject suggested dependency: Checkout depends on Ledger',
      })
    ).toBeInTheDocument();

    const graph = container.querySelector('[data-testid="service-dependency-graph"]')!;
    expect(graph).toHaveAttribute('aria-hidden', 'true');
    expect(graph.querySelectorAll('[data-edge-status="active"]')).toHaveLength(2);
    expect(graph.querySelectorAll('[data-edge-status="suggested"]')).toHaveLength(1);
    expect(graph.textContent).toContain('Suggested');

    rerender(<DependenciesPanel data={neighbourhood} canManage={false} />);
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.getByText('Checkout depends on Ledger')).toBeInTheDocument();
  });

  it('renders no dependency card without edges and caps the drawing', () => {
    const { container, rerender } = render(
      <DependenciesPanel data={{ ...neighbourhood, neighbours: [], edges: [] }} canManage />
    );
    expect(container).toBeEmptyDOMElement();
    const many = Array.from({ length: GRAPH_MAX_PER_SIDE + 3 }, (_, index) => index);
    rerender(
      <DependenciesPanel
        canManage={false}
        data={{
          focus: neighbourhood.focus,
          neighbours: many.map(index => node(`n-${index}`, `Dep ${index}`)),
          edges: many.map(index => ({
            id: `m-${index}`,
            direction: 'UPSTREAM' as const,
            neighbourId: `n-${index}`,
            origin: 'DECLARED' as const,
            status: 'ACTIVE' as const,
            confidence: 1,
          })),
          truncated: true,
        }}
      />
    );
    const graph = container.querySelector('[data-testid="service-dependency-graph"]')!;
    expect(graph.querySelectorAll('[data-edge-status]')).toHaveLength(GRAPH_MAX_PER_SIDE);
    expect(graph.textContent).toContain('+3 more in the list');
    expect(
      within(screen.getByRole('list', { name: 'Dependencies' })).getAllByRole('listitem')
    ).toHaveLength(GRAPH_MAX_PER_SIDE + 3);
    expect(screen.getByText(/Only the most recent dependencies are shown/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See all dependencies' })).not.toBeInTheDocument();
  });

  it('shows SLO burn per objective with its state in words, and nothing without an SLO', () => {
    const { container, rerender } = render(<SloBurnPanel burn={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <SloBurnPanel
        burn={{
          serviceId: 'svc-1',
          downtimeMinutes: { fast: 20, slow: 20 },
          burning: true,
          severity: 'critical',
          objectives: [
            {
              objectiveId: 'o1',
              name: 'Availability',
              targetPercent: 99.9,
              fastBurn: 333.33,
              slowBurn: 55.56,
              severity: 'critical',
              budgetMinutes: 43.2,
            },
            {
              objectiveId: 'o2',
              name: 'Uptime',
              targetPercent: 95,
              fastBurn: 0.2,
              slowBurn: 0.1,
              severity: 'none',
              budgetMinutes: null,
            },
          ],
        }}
      />
    );
    expect(screen.getByRole('heading', { name: 'SLO burn' })).toBeInTheDocument();
    expect(screen.getByText('Burning fast')).toBeInTheDocument();
    expect(screen.getByText('Within budget')).toBeInTheDocument();
    expect(screen.getByText('333.33×')).toBeInTheDocument();
    expect(screen.getByText(/target 99.9% · 43.2 min budget/)).toBeInTheDocument();
  });

  it('offers the alert-quality fixes to a manager of a flagged service only', () => {
    const quality = {
      windowDays: 30,
      incidents: 12,
      quickResolvedRatio: 0.75,
      neverAcknowledgedRatio: 0.5,
      flappingRatio: 0,
      noiseScore: 0.625,
      flagged: true,
    };
    const props = { serviceId: 'svc-1', serviceName: 'Checkout', jiraConfigured: false };
    const { container, rerender } = render(
      <AlertQualityPanel quality={null} canManage {...props} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<AlertQualityPanel quality={quality} canManage {...props} />);
    expect(screen.getByText('62.5%')).toBeInTheDocument();
    expect(screen.getByText('Flagged as noisy')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create suppression rule for Checkout' })
    ).toHaveAttribute('href', '/settings/intelligence/noise-controls?service=svc-1');
    expect(screen.getByRole('link', { name: 'Lower severity for Checkout' })).toHaveAttribute(
      'href',
      '/services/svc-1?tab=automation'
    );
    expect(screen.queryByRole('button', { name: /Jira/i })).not.toBeInTheDocument();

    rerender(<AlertQualityPanel quality={quality} canManage={false} {...props} />);
    expect(screen.queryByRole('link', { name: /Create suppression rule/ })).not.toBeInTheDocument();
    rerender(
      <AlertQualityPanel
        quality={{ ...quality, flagged: false, noiseScore: 0.1 }}
        canManage
        {...props}
      />
    );
    expect(screen.queryByRole('link', { name: /Create suppression rule/ })).not.toBeInTheDocument();
    expect(screen.getByText('12 incidents sampled')).toBeInTheDocument();
  });

  it('lists changes with a risk band in words', () => {
    const { container, rerender } = render(
      <ChangesPanel changes={[]} timeZone="UTC" windowDays={14} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <ChangesPanel
        timeZone="UTC"
        windowDays={14}
        changes={[
          {
            id: 'c1',
            kind: 'DEPLOY',
            source: 'github',
            summary: 'api v9',
            version: 'v9',
            occurredAt: new Date('2026-11-10T10:00:00Z'),
            riskScore: 0.81,
          },
          {
            id: 'c2',
            kind: 'FEATURE_FLAG',
            source: 'launchdarkly',
            summary: 'new-checkout on',
            version: null,
            occurredAt: new Date('2026-11-09T10:00:00Z'),
            riskScore: null,
          },
        ]}
      />
    );
    expect(screen.getByRole('link', { name: 'api v9' })).toHaveAttribute('href', '/changes/c1');
    expect(screen.getByText('High risk · 81%')).toBeInTheDocument();
    expect(screen.getByText(/Feature flag · launchdarkly/)).toBeInTheDocument();
    expect(screen.getAllByText(/risk ·/)).toHaveLength(1);
  });

  it('shows noise state, and stays silent for a responder when everything is off', () => {
    const off: ServiceNoiseStatus = {
      mode: 'OFF',
      source: 'default',
      days: 7,
      alerts: 0,
      incidents: 0,
      pagesAvoided: 0,
      shadowWouldAvoid: 0,
      activeWindows: [],
      heartbeats: { monitors: 0, missing: [] },
    };
    const props = { serviceId: 'svc-1', timeZone: 'UTC' };
    const { container, rerender } = render(
      <NoiseStatusPanel status={off} canManage={false} {...props} />
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<NoiseStatusPanel status={off} canManage {...props} />);
    expect(screen.getByRole('link', { name: 'Turn on noise controls' })).toHaveAttribute(
      'href',
      '/settings/intelligence/noise-controls?service=svc-1'
    );

    rerender(
      <NoiseStatusPanel
        canManage={false}
        {...props}
        status={{
          ...off,
          mode: 'ON',
          source: 'global',
          alerts: 400,
          incidents: 40,
          pagesAvoided: 55,
          activeWindows: [
            {
              id: 'w1',
              name: 'DB upgrade',
              scope: 'SERVICE',
              effect: 'SUPPRESS',
              endsAt: new Date('2026-11-10T12:00:00Z'),
              recurring: false,
            },
          ],
          heartbeats: {
            monitors: 2,
            missing: [{ id: 'h1', name: 'nightly cron', missingSince: null }],
          },
        }}
      />
    );
    expect(screen.getByText('Inherited from all services')).toBeInTheDocument();
    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.getByText('400 → 40')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Active maintenance windows' })).getByText(
        'DB upgrade'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('1 missing')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Missing heartbeats' })).getByText('nightly cron')
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /noise controls/i })).not.toBeInTheDocument();
  });

  it('explains the automatic-mode gate and hides it from a responder when intelligence is off', () => {
    const gate = {
      mode: 'OFF' as const,
      source: 'default' as const,
      allowed: false,
      reason: 'No completed quality certification for this service.',
      certified: false,
    };
    const { container, rerender } = render(
      <AutoGatePanel gate={gate} serviceName="Checkout" canManage={false} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<AutoGatePanel gate={gate} serviceName="Checkout" canManage />);
    expect(
      screen.getByRole('link', { name: 'Turn on Intelligence for this service' })
    ).toHaveAttribute('href', '/settings/intelligence/services?q=Checkout');
    rerender(
      <AutoGatePanel
        gate={{ ...gate, mode: 'SUGGEST', source: 'global' }}
        serviceName="Checkout"
        canManage={false}
      />
    );
    expect(screen.getByText('Suggest')).toBeInTheDocument();
    expect(screen.getByText('Not certified')).toBeInTheDocument();
    expect(
      screen.getByText('No completed quality certification for this service.')
    ).toBeInTheDocument();
  });

  it('lists recurring problems and links learned facts to the Squire memory page', () => {
    const { container, rerender } = render(
      <RecurringProblemsPanel problems={[]} timeZone="UTC" windowDays={30} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<LearnedFactsPanel facts={0} serviceId="svc-1" />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <>
        <RecurringProblemsPanel
          timeZone="UTC"
          windowDays={30}
          problems={[
            {
              serviceId: 'svc-1',
              serviceName: 'Checkout',
              template: 'disk full on <host>',
              occurrences: 6,
              distinctDays: 4,
              lastSeenAt: new Date('2026-11-09T10:00:00Z'),
              latestIncidentId: 'inc-9',
              hasRunbook: false,
            },
          ]}
        />
        <LearnedFactsPanel facts={3} serviceId="svc-1" />
      </>
    );
    expect(screen.getByRole('link', { name: 'disk full on <host>' })).toHaveAttribute(
      'href',
      '/incidents/inc-9'
    );
    expect(screen.getByText('No runbook attached')).toBeInTheDocument();
    expect(screen.getByText(/6 times on 4 days/)).toBeInTheDocument();
    expect(screen.getByText('3 confirmed facts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Squire memory' })).toHaveAttribute(
      'href',
      '/settings/intelligence/services/svc-1/squire'
    );
  });
});

describe('ServiceDetailTabs', () => {
  const base = {
    activeIncidentCount: 0,
    integrationCount: 0,
    incidentsContent: <p>incidents</p>,
    escalationContent: <p>escalation</p>,
    runbooksContent: <p>runbooks</p>,
    integrationsContent: <p>integrations</p>,
    notificationsContent: <p>notifications</p>,
    maintenanceContent: <p>maintenance</p>,
    settingsContent: <p>settings</p>,
  };

  it('offers the Intelligence tab only when asked to', () => {
    const { rerender } = render(<ServiceDetailTabs {...base} />);
    expect(screen.queryByRole('tab', { name: /Intelligence/ })).not.toBeInTheDocument();
    rerender(
      <ServiceDetailTabs
        {...base}
        defaultTab="intelligence"
        showIntelligenceTab
        intelligenceContent={<p>intelligence content</p>}
      />
    );
    expect(screen.getByRole('tab', { name: /Intelligence/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText('intelligence content')).toBeInTheDocument();
  });
});
