import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceGraphView } from '@/lib/intelligence/dependencies/graph-view';
import type { ServiceGraphCanvasProps } from '@/components/service-graph/ServiceGraphCanvas';

const actions = vi.hoisted(() => ({
  connectServicesAction: vi.fn(),
  disconnectDependencyAction: vi.fn(),
  reviewSuggestedDependencyAction: vi.fn(),
  getGraphNodeDetailsAction: vi.fn().mockResolvedValue(null),
  getGraphStatusesAction: vi.fn().mockResolvedValue(null),
  expandNeighboursAction: vi.fn().mockResolvedValue(null),
  getGraphAtAction: vi.fn(),
  getGraphTimelineAction: vi.fn().mockResolvedValue({ ok: false, message: 'x' }),
  diffGraphAction: vi.fn().mockResolvedValue({ ok: false, message: 'x' }),
  findSpofAction: vi.fn().mockResolvedValue({ ok: false, message: 'x' }),
  simulateFailureAction: vi.fn().mockResolvedValue({ ok: false, message: 'x' }),
  listGraphViewsAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createGraphViewAction: vi.fn(),
  deleteGraphViewAction: vi.fn(),
  shareGraphViewAction: vi.fn(),
  revokeGraphShareAction: vi.fn(),
}));
vi.mock('@/app/(app)/services/graph/actions', () => actions);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
// React Flow cannot measure anything in jsdom; a stub shows what the explorer hands the canvas.
vi.mock('@/components/service-graph/ServiceGraphCanvas', () => ({
  default: (props: ServiceGraphCanvasProps) => (
    <div data-testid="canvas">
      {props.items.map(item => (
        <button key={item.key} type="button" onClick={() => props.onSelect(item.key)}>
          node {item.name}
          {item.filteredOut ? ' (filtered)' : ''}
        </button>
      ))}
      {props.links.map(link => (
        <button key={link.key} type="button" onClick={() => props.onLinkClick(link)}>
          edge {link.key}
        </button>
      ))}
    </div>
  ),
}));

import ServiceGraphExplorer from '@/components/service-graph/ServiceGraphExplorer';
import GraphInsightsPanel from '@/components/service-graph/GraphInsightsPanel';

const node = (id: string, name: string, teamId: string) => ({
  id,
  name,
  teamId,
  teamName: teamId === 't1' ? 'Storefront' : 'Data',
  openIncidents: 0,
  highestOpenUrgency: null,
  status: 'OPERATIONAL' as const,
});
const graph: ServiceGraphView = {
  nodes: [node('web', 'Web', 't1'), node('db', 'Orders DB', 't2'), node('cache', 'Cache', 't2')],
  edges: [
    {
      id: 'e1',
      upstreamServiceId: 'db',
      downstreamServiceId: 'web',
      origin: 'DECLARED',
      status: 'ACTIVE',
      confidence: 1,
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
      status: 'OPERATIONAL',
      reasons: [],
      openIncidents: 0,
      memberCount: 1,
    },
  ],
  memberEdges: [{ businessServiceId: 'checkout', serviceId: 'web', critical: true }],
  supportEdges: [],
  focus: null,
};
const viewer = {
  id: 'u1',
  isAdmin: false,
  canOrgViews: false,
  seesSuggestions: true,
  embedEnabled: false,
  teams: [],
};
const renderExplorer = (over: { team?: string; squireName?: string | null } = {}) =>
  render(
    <ServiceGraphExplorer
      graph={graph}
      teams={[]}
      canEdit
      viewer={{ ...viewer, squireName: over.squireName ?? null }}
      focusName={null}
      initial={{ q: '', team: over.team ?? '', impacted: false, view: 'graph' }}
    />
  );

beforeEach(() => vi.clearAllMocks());

describe('ServiceGraphExplorer canvas wiring', () => {
  it('keeps the blast radius whole when filters hide part of it, and summarises it', async () => {
    renderExplorer({ team: 't2' });
    expect(screen.queryByRole('button', { name: /^node Web/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'node Orders DB' }));
    fireEvent.click(screen.getByRole('button', { name: /Blast radius/ }));
    // Web depends on the DB and Checkout contains Web: both are reached through the hidden Web.
    expect(screen.getByRole('button', { name: 'node Web (filtered)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'node Checkout (filtered)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'edge dep:e1' })).toBeInTheDocument();
    expect(
      screen.getByText(/affected · 1 at 1 hop, 1 at 2 hops · 2 hidden by filters/)
    ).toBeInTheDocument();
  });

  it('opens edge details on click, with Remove as a second, confirmed step', async () => {
    actions.disconnectDependencyAction.mockResolvedValue({ ok: true, message: 'Removed.' });
    renderExplorer();
    fireEvent.click(await screen.findByRole('button', { name: 'edge dep:e1' }));
    const details = await screen.findByRole('alertdialog');
    expect(within(details).getByText('Dependency')).toBeInTheDocument();
    expect(within(details).getByText('Hard (fails with it)')).toBeInTheDocument();
    expect(within(details).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: 'Remove…' }));
    expect(actions.disconnectDependencyAction).not.toHaveBeenCalled();
    expect(await screen.findByText('Remove dependency?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(actions.disconnectDependencyAction).toHaveBeenCalledWith({ dependencyId: 'e1' })
    );
  });

  it('collapses business services, and a relation picked in the panel unfolds and selects it', async () => {
    renderExplorer();
    fireEvent.click(await screen.findByRole('button', { name: /Collapse business services/ }));
    expect(screen.queryByRole('button', { name: 'node Web' })).not.toBeInTheDocument();
    // Web's dependency on the DB now leaves Checkout.
    expect(
      screen.getByRole('button', { name: 'edge agg:dependency:bs:checkout>svc:db' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'node Checkout' }));
    expect(screen.getByRole('button', { name: /Show member services/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Web' }));
    expect(await screen.findByRole('heading', { name: 'Web' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'node Web' })).toBeInTheDocument();
  });

  it('asks the assistant about the selected service through the shared Squire bus', async () => {
    const opened = vi.fn();
    window.addEventListener('squire:open', opened);
    try {
      renderExplorer({ squireName: 'Pip' });
      fireEvent.click(await screen.findByRole('button', { name: 'node Web' }));
      fireEvent.click(screen.getByRole('button', { name: 'Ask Pip about this service' }));
      const detail = (opened.mock.calls[0][0] as CustomEvent).detail;
      expect(detail.question).toContain('Web');
      expect(detail.evidence).toMatchObject({ kind: 'service', id: 'web' });
      expect(detail.message).toBeUndefined();
    } finally {
      window.removeEventListener('squire:open', opened);
    }
  });

  it('hides Ask when the assistant is off, and keeps the legend collapsed until asked', async () => {
    renderExplorer();
    fireEvent.click(await screen.findByRole('button', { name: 'node Web' }));
    expect(screen.queryByRole('button', { name: /^Ask / })).not.toBeInTheDocument();
    const legend = screen.getByRole('button', { name: 'Legend' });
    expect(legend).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(legend);
    expect(screen.getByRole('region', { name: 'Legend' })).toBeInTheDocument();
    expect(screen.getByText('Supporting business service')).toBeInTheDocument();
  });
});

describe('time-travel slider', () => {
  it('steps a day at a time and marks days with incidents or dependency changes', async () => {
    const incidents = new Array(90).fill(0);
    const changes = new Array(90).fill(0);
    incidents[0] = 2;
    incidents[10] = 1;
    changes[3] = 4;
    actions.getGraphTimelineAction.mockResolvedValueOnce({
      ok: true,
      data: { days: 90, incidents, changes, truncated: false },
    });
    render(
      <GraphInsightsPanel
        focus="svc:web"
        hops={2}
        seesSuggestions
        at={null}
        onTravel={vi.fn()}
        onDiff={vi.fn()}
        onSpof={vi.fn()}
        onShowSuggested={vi.fn()}
        onSelectService={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Time travel/ }));
    const slider = screen.getByLabelText('Time, last 90 days');
    expect(slider).toHaveAttribute('max', '90');
    expect(slider).toHaveAttribute('step', '1');
    const ticks = await screen.findByTestId('timeline-ticks');
    expect(ticks.querySelectorAll('span')).toHaveLength(3);
    expect(within(ticks).getByTitle('2 incidents opened')).toBeInTheDocument();
    expect(within(ticks).getByTitle('4 dependency changes')).toBeInTheDocument();
    expect(actions.getGraphTimelineAction).toHaveBeenCalledWith({ focus: 'svc:web', hops: 2 });
  });
});
