import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceGraphView } from '@/lib/intelligence/dependencies/graph-view';

const actions = vi.hoisted(() => ({
  connectServicesAction: vi.fn(),
  disconnectDependencyAction: vi.fn(),
  reviewSuggestedDependencyAction: vi.fn(),
  getGraphNodeDetailsAction: vi.fn(),
  getGraphStatusesAction: vi.fn().mockResolvedValue(null),
  expandNeighboursAction: vi.fn().mockResolvedValue(null),
  getGraphAtAction: vi.fn(),
  diffGraphAction: vi.fn().mockResolvedValue({ ok: false, message: 'x' }),
  findSpofAction: vi.fn().mockResolvedValue({ ok: false, message: 'x' }),
  simulateFailureAction: vi.fn().mockResolvedValue({ ok: false, message: 'x' }),
  listGraphViewsAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createGraphViewAction: vi.fn(),
  deleteGraphViewAction: vi.fn(),
  shareGraphViewAction: vi.fn(),
  revokeGraphShareAction: vi.fn(),
}));
const viewer = {
  id: 'u1',
  isAdmin: false,
  canOrgViews: false,
  seesSuggestions: true,
  embedEnabled: false,
  teams: [],
};
vi.mock('@/app/(app)/services/graph/actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import GraphListView from '@/components/service-graph/GraphListView';
import GraphSidePanel from '@/components/service-graph/GraphSidePanel';
import ServiceGraphExplorer from '@/components/service-graph/ServiceGraphExplorer';
import { buildGraphModel, filterGraph, oneHop } from '@/components/service-graph/model';

const graph: ServiceGraphView = {
  nodes: [
    {
      id: 'web',
      name: 'Web',
      teamId: 't1',
      teamName: 'Storefront',
      openIncidents: 1,
      highestOpenUrgency: 'HIGH',
      status: 'MAJOR_OUTAGE',
    },
    {
      id: 'db',
      name: 'Orders DB',
      teamId: 't2',
      teamName: 'Data',
      openIncidents: 0,
      highestOpenUrgency: null,
      status: 'OPERATIONAL',
    },
    {
      id: 'cache',
      name: 'Cache',
      teamId: 't2',
      teamName: 'Data',
      openIncidents: 0,
      highestOpenUrgency: null,
      status: 'OPERATIONAL',
    },
  ],
  edges: [
    {
      id: 'e1',
      upstreamServiceId: 'db',
      downstreamServiceId: 'web',
      origin: 'DECLARED',
      status: 'ACTIVE',
      confidence: 1,
    },
    {
      id: 'e2',
      upstreamServiceId: 'cache',
      downstreamServiceId: 'web',
      origin: 'OBSERVED',
      status: 'SUGGESTED',
      confidence: 0.7,
    },
  ],
  truncated: false,
  businessServices: [
    {
      id: 'checkout',
      name: 'Checkout',
      teamId: 't1',
      teamName: 'Storefront',
      criticality: 'TIER_0',
      status: 'MAJOR_OUTAGE',
      reasons: [
        {
          kind: 'DIRECT',
          status: 'MAJOR_OUTAGE',
          incidentId: 'i1',
          serviceId: 'web',
          urgency: 'HIGH',
        },
      ],
      openIncidents: 1,
      memberCount: 1,
    },
  ],
  memberEdges: [{ businessServiceId: 'checkout', serviceId: 'web', critical: true }],
  supportEdges: [],
  focus: null,
};

const model = buildGraphModel(graph);
const item = (key: string) => model.items.find(entry => entry.key === key)!;

beforeEach(() => {
  vi.clearAllMocks();
  actions.getGraphNodeDetailsAction.mockResolvedValue({
    owner: { id: 't1', name: 'Storefront' },
    onCall: { label: 'Primary', names: ['Ada Lovelace'] },
    incidents: [
      {
        id: 'i1',
        title: 'Checkout errors',
        urgency: 'HIGH',
        status: 'OPEN',
        createdAt: new Date().toISOString(),
      },
    ],
  });
});

describe('graph model', () => {
  it('points every link from the dependent to its dependency', () => {
    expect(model.links.map(link => [link.source, link.target, link.kind, link.suggested])).toEqual([
      ['svc:web', 'svc:db', 'dependency', false],
      ['svc:web', 'svc:cache', 'dependency', true],
      ['bs:checkout', 'svc:web', 'member', false],
    ]);
    expect(oneHop(model.links, 'svc:web')).toEqual(
      new Set(['svc:web', 'svc:db', 'svc:cache', 'bs:checkout'])
    );
  });

  it('filters by search, team and impact, keeping only links between kept items', () => {
    const data = filterGraph(model, { query: '', teamId: 't2', impactedOnly: false });
    expect(data.items.map(entry => entry.key)).toEqual(['svc:db', 'svc:cache']);
    expect(data.links).toEqual([]);
    const impacted = filterGraph(model, { query: '', teamId: '', impactedOnly: true });
    expect(impacted.items.map(entry => entry.key)).toEqual(['bs:checkout', 'svc:web']);
    expect(
      filterGraph(model, { query: 'orders', teamId: '', impactedOnly: false }).items
    ).toHaveLength(1);
  });
});

describe('GraphListView', () => {
  it('lists every node with status and relation counts, and opens one on click', () => {
    const onSelect = vi.fn();
    render(
      <GraphListView
        items={model.items}
        links={model.links}
        selectedKey={null}
        onSelect={onSelect}
      />
    );
    const row = screen.getByRole('button', { name: /^Web/ }).closest('tr')!;
    expect(within(row).getByText('Major outage')).toBeInTheDocument();
    // Web depends on two services and is used by one business service.
    expect(within(row).getAllByText('2')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Orders DB/ }));
    expect(onSelect).toHaveBeenCalledWith('svc:db');
  });

  it('explains an empty filter result', () => {
    render(<GraphListView items={[]} links={[]} selectedKey={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Nothing matches these filters')).toBeInTheDocument();
  });
});

describe('GraphSidePanel', () => {
  const relations = (key: string) => ({
    dependsOn: model.links
      .filter(link => link.source === key)
      .map(link => ({ link, other: item(link.target) })),
    usedBy: model.links
      .filter(link => link.target === key)
      .map(link => ({ link, other: item(link.source) })),
  });

  it('shows status, on call, open incidents and relations, and focuses its heading', () => {
    const { dependsOn, usedBy } = relations('svc:web');
    render(
      <GraphSidePanel
        item={item('svc:web')}
        dependsOn={dependsOn}
        usedBy={usedBy}
        details={{
          owner: { id: 't1', name: 'Storefront' },
          onCall: { label: 'Primary', names: ['Ada Lovelace'] },
          incidents: [
            {
              id: 'i1',
              title: 'Checkout errors',
              urgency: 'HIGH',
              status: 'OPEN',
              createdAt: new Date().toISOString(),
            },
          ],
        }}
        nameOf={key => item(key)?.name ?? '?'}
        canEdit={false}
        onClose={vi.fn()}
        onDisconnect={vi.fn()}
        onReview={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Web' })).toHaveFocus();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Checkout errors' })).toHaveAttribute(
      'href',
      '/incidents/i1'
    );
    expect(screen.getByRole('link', { name: /Service page/ })).toHaveAttribute(
      'href',
      '/services/web'
    );
    expect(screen.queryByRole('button', { name: /Remove dependency/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage dependencies' })).not.toBeInTheDocument();
  });

  it('offers remove and accept/reject to editors, and closes on Escape', () => {
    const onDisconnect = vi.fn();
    const onReview = vi.fn();
    const onClose = vi.fn();
    const { dependsOn, usedBy } = relations('svc:web');
    render(
      <GraphSidePanel
        item={item('svc:web')}
        dependsOn={dependsOn}
        usedBy={usedBy}
        details={undefined}
        nameOf={key => item(key)?.name ?? '?'}
        canEdit
        onClose={onClose}
        onDisconnect={onDisconnect}
        onReview={onReview}
      />
    );
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove dependency with Orders DB' }));
    expect(onDisconnect).toHaveBeenCalledWith(expect.objectContaining({ dependencyId: 'e1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept suggested dependency with Cache' }));
    expect(onReview).toHaveBeenCalledWith(
      expect.objectContaining({ dependencyId: 'e2' }),
      'APPROVE'
    );
    expect(screen.getByRole('link', { name: 'Manage dependencies' })).toHaveAttribute(
      'href',
      '/services/web?tab=intelligence'
    );
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Web' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('explains why a business service is impacted', () => {
    render(
      <GraphSidePanel
        item={item('bs:checkout')}
        dependsOn={relations('bs:checkout').dependsOn}
        usedBy={[]}
        details={null}
        nameOf={key => item(key)?.name ?? '?'}
        canEdit={false}
        onClose={vi.fn()}
        onDisconnect={vi.fn()}
        onReview={vi.fn()}
      />
    );
    expect(screen.getByText('Major outage: open incident on Web')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Overview/ })).toHaveAttribute(
      'href',
      '/services/business/checkout'
    );
  });
});

describe('ServiceGraphExplorer list view', () => {
  it('filters the list and loads side-panel details for the selected row', async () => {
    render(
      <ServiceGraphExplorer
        graph={graph}
        teams={[
          { id: 't1', name: 'Storefront' },
          { id: 't2', name: 'Data' },
        ]}
        canEdit
        viewer={viewer}
        focusName={null}
        initial={{ q: '', team: '', impacted: false, view: 'list' }}
      />
    );
    expect(screen.getAllByRole('row')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: /Impacted only/ }));
    expect(screen.getAllByRole('row')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /^Web/ }));
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(actions.getGraphNodeDetailsAction).toHaveBeenCalledWith({ kind: 'svc', id: 'web' });
    expect(window.location.search).toContain('view=list');
    expect(window.location.search).toContain('impacted=1');
  });

  it('confirms before removing a dependency', async () => {
    actions.disconnectDependencyAction.mockResolvedValue({
      ok: true,
      message: 'Dependency removed.',
    });
    render(
      <ServiceGraphExplorer
        graph={graph}
        teams={[]}
        canEdit
        viewer={viewer}
        focusName={null}
        initial={{ q: '', team: '', impacted: false, view: 'list' }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Web/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove dependency with Orders DB' })
    );
    expect(actions.disconnectDependencyAction).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(actions.disconnectDependencyAction).toHaveBeenCalledWith({ dependencyId: 'e1' })
    );
  });
});

describe('ServiceGraphExplorer insights', () => {
  it('opens the time-travel scrubber and shows the single-points-of-failure list with a show-on-graph action', async () => {
    actions.findSpofAction.mockResolvedValueOnce({
      ok: true,
      data: {
        threshold: 5,
        truncated: false,
        articulationPoints: [],
        singlePointsOfFailure: [
          {
            serviceId: 'orders-db',
            name: 'Orders DB',
            fanOut: 6,
            businessServiceCount: 1,
            criticalBusinessServiceCount: 1,
            articulationPoint: true,
            reasons: ['NO_ON_CALL'],
            score: 30,
          },
        ],
      },
    });
    render(
      <ServiceGraphExplorer
        graph={graph}
        teams={[]}
        canEdit
        viewer={viewer}
        focusName={null}
        initial={{ q: '', team: '', impacted: false, view: 'list' }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Time travel/ }));
    expect(screen.getByLabelText('Time, last 90 days')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to now/ })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: /Single points of failure/ }));
    expect(await screen.findByText('Orders DB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show on graph' })).toBeTruthy();
  });
});
