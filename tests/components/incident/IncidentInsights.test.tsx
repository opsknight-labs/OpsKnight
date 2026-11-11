import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loader = vi.hoisted(() => ({ insights: vi.fn(), axis: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/intelligence/incident-ux/strip', async () => {
  const actual = await vi.importActual<typeof import('@/lib/intelligence/incident-ux/strip')>(
    '@/lib/intelligence/incident-ux/strip'
  );
  return {
    ...actual,
    incidentInsightsForRequest: loader.insights,
    incidentTimeAxisForRequest: loader.axis,
  };
});
vi.mock('@/app/(app)/incidents/[id]/triage-actions', () => ({ decideTriage: vi.fn() }));
vi.mock('@/app/(app)/incidents/[id]/intelligence-actions', () => ({
  rateSimilarIncident: vi.fn(),
  decideRelatedIncident: vi.fn(),
  markIncidentRelated: vi.fn(),
  summarizeIncidentAction: vi.fn(),
}));
vi.mock('@/app/(app)/incidents/[id]/noise-actions', () => ({
  reverseIncidentNoiseDecision: vi.fn(),
  postSummaryAsNoteAction: vi.fn(),
}));
vi.mock('@/components/incident/detail/actions', () => ({
  loadOlderIncidentTimelineActivity: vi.fn(),
}));
// The host and the runbook launcher are exercised in their own tests; here they are stand-ins.
vi.mock('@/components/incident/intelligence/InsightsInspectorHost', () => ({
  default: ({
    sections,
    presentation,
    children,
  }: {
    sections: string[];
    presentation: string;
    children: React.ReactNode;
  }) => (
    <div data-testid="host" data-sections={sections.join(',')} data-presentation={presentation}>
      {children}
    </div>
  ),
}));
vi.mock('@/components/incident/runbooks/AdhocRunbookLauncher', () => ({
  default: ({ label, initialRunbookId }: { label: string; initialRunbookId: string }) => (
    <button type="button" data-runbook={initialRunbookId}>
      {label}
    </button>
  ),
}));

import IncidentInsights, {
  IncidentGroupLine,
  IncidentTimelineWithIntelligence,
  SuggestedRunbooks,
} from '@/components/incident/intelligence/IncidentInsights';
import IntelligenceStrip from '@/components/incident/intelligence/IntelligenceStrip';
import { buildStripChips } from '@/lib/intelligence/incident-ux/strip';
import { busyInsights, quietInsights } from '../../helpers/incident-insights-fixture';

beforeEach(() => {
  vi.clearAllMocks();
  loader.axis.mockResolvedValue(null);
});

const renderInsights = async (presentation: 'desktop' | 'mobile' = 'desktop') =>
  render(<>{await IncidentInsights({ incidentId: 'inc-1', presentation })}</>);

describe('IntelligenceStrip', () => {
  it('renders nothing when there is no chip and no freshness to report', () => {
    const { container } = render(
      <IntelligenceStrip incidentId="inc-1" chips={[]} freshness={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('is one row of links: inspector chips carry the section, the noise chip jumps to the timeline', () => {
    render(
      <IntelligenceStrip
        incidentId="inc-1"
        chips={buildStripChips(busyInsights())}
        freshness={null}
      />
    );
    const strip = screen.getByRole('navigation', { name: 'Incident insights' });
    const similar = within(strip).getByRole('link', { name: '1 similar' });
    expect(similar).toHaveAttribute('href', '?insights=similar');
    expect(similar).toHaveAttribute('data-insights-open', 'similar');
    // 44 px touch target on phones, compact on desktop; never wraps, so the row scrolls sideways.
    expect(similar.className).toContain('min-h-11');
    expect(similar.className).toContain('whitespace-nowrap');
    expect(strip.className).toContain('overflow-x-auto');
    const noise = within(strip).getByRole('link', { name: 'Suppressed by Known noisy probe' });
    expect(noise).toHaveAttribute('href', '#timeline-intelligence');
    expect(noise).not.toHaveAttribute('data-insights-open');
    expect(within(strip).getByRole('link', { name: /Insights/ })).toHaveAttribute(
      'href',
      '?insights=triage'
    );
    expect(screen.queryByRole('group', { name: 'Recommendation freshness' })).toBeNull();
  });

  it('shows the freshness dot on its own when analysis is unfinished and nothing else is known', () => {
    render(
      <IntelligenceStrip
        incidentId="inc-1"
        chips={[]}
        freshness={{ status: 'WAITING', message: 'Waiting for analysis.', canRefresh: false }}
      />
    );
    expect(screen.getByRole('group', { name: 'Recommendation freshness' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('offers no "Insights" opener when its only chip leads to the timeline', () => {
    render(
      <IntelligenceStrip
        incidentId="inc-1"
        chips={buildStripChips(
          quietInsights({ noise: [{ kind: 'maintenance', label: 'In maintenance' }] })
        )}
        freshness={null}
      />
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'In maintenance' })).toBeInTheDocument();
  });
});

describe('IncidentInsights', () => {
  it('renders nothing at all when the loader has nothing (OFF for a responder, no access, failure)', async () => {
    loader.insights.mockResolvedValue(null);
    expect(await IncidentInsights({ incidentId: 'inc-1' })).toBeNull();
    expect(await IncidentGroupLine({ incidentId: 'inc-1' })).toBeNull();
    expect(await SuggestedRunbooks({ incidentId: 'inc-1' })).toBeNull();
  });

  it('is silent for a quiet incident: no strip, and an inspector with a single line', async () => {
    loader.insights.mockResolvedValue(quietInsights());
    await renderInsights();
    expect(screen.queryByTestId('intelligence-strip')).toBeNull();
    expect(screen.getByTestId('host')).toHaveAttribute('data-sections', '');
    expect(screen.getByText('Nothing to show for this incident yet.')).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('renders every section once, in order, each item with a stable anchor', async () => {
    loader.insights.mockResolvedValue(busyInsights());
    const { container } = await renderInsights();
    expect(screen.getByTestId('host')).toHaveAttribute(
      'data-sections',
      'briefing,triage,similar,related,why,runbooks,impact,summary'
    );
    expect([...container.querySelectorAll('[id^="insights-"]')].map(node => node.id)).toEqual([
      'insights-briefing',
      'insights-triage',
      'insights-similar',
      'insights-related',
      'insights-why',
      'insights-runbooks',
      'insights-impact',
      'insights-summary',
    ]);
    for (const id of ['t1', 't2', 's1', 'rel-1', 'c1', 'u1', 'r1'])
      expect(container.querySelector(`#finding-${id}`), id).not.toBeNull();
    // One heading per fact: no duplicated section names.
    for (const name of [
      'Triage suggestions',
      'Similar past incidents',
      'Related incidents',
      'Possible causes',
      'Runbooks that have worked here',
      'Estimated impact',
      'AI summary',
    ])
      expect(screen.getAllByRole('heading', { name })).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Recommendation freshness' })).toBeNull();
  });

  it('keeps the existing accept, dismiss and feedback controls on the items', async () => {
    loader.insights.mockResolvedValue(busyInsights());
    await renderInsights();
    const similar = screen.getByRole('region', { name: 'Similar past incidents' });
    expect(within(similar).getByRole('button', { name: 'Helpful' })).toBeInTheDocument();
    expect(within(similar).getByText('Fixed by: Restarted the pool')).toBeInTheDocument();
    expect(within(similar).getByText(/resolved in 3 h 10 min/)).toBeInTheDocument();
    const triage = screen.getByRole('region', { name: 'Triage suggestions' });
    expect(within(triage).getAllByRole('button', { name: 'Apply' })[0].className).toContain('h-11');
    expect(
      within(screen.getByRole('region', { name: 'Related incidents' })).getByText(
        /Automatically grouped after paging/
      )
    ).toBeInTheDocument();
  });

  it('hides feedback controls from a viewer who may not give feedback', async () => {
    loader.insights.mockResolvedValue(busyInsights({ canGiveFeedback: false }));
    await renderInsights();
    expect(screen.queryByRole('button', { name: 'Helpful' })).toBeNull();
  });

  it('opens the assistant about one item, with a question and that item’s evidence handle', async () => {
    loader.insights.mockResolvedValue(busyInsights());
    await renderInsights();
    const opened = vi.fn();
    window.addEventListener('squire:open', opened);
    fireEvent.click(
      screen.getByRole('button', { name: 'Ask Pip about Checkout pool exhausted (last month)' })
    );
    window.removeEventListener('squire:open', opened);
    expect(opened).toHaveBeenCalledTimes(1);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
      question:
        'Have we seen this before? Compare this incident with the similar incident "Checkout pool exhausted (last month)".',
      evidence: { kind: 'similar', id: 's1', label: 'Checkout pool exhausted (last month)' },
      incidentId: 'inc-1',
    });
    // Every item and section offers it, with a touch-sized target.
    const asks = screen.getAllByRole('button', { name: /^Ask Pip about / });
    expect(asks.length).toBeGreaterThanOrEqual(9);
    expect(asks.every(button => button.className.includes('min-h-11'))).toBe(true);
  });

  it('offers no assistant action while the assistant is off, or off on the mobile route', async () => {
    loader.insights.mockResolvedValue(
      busyInsights({ squire: { enabled: false, mobileEnabled: false, name: 'Pip' } })
    );
    const first = await renderInsights();
    expect(screen.queryByRole('button', { name: /^Ask Pip/ })).toBeNull();
    first.unmount();

    loader.insights.mockResolvedValue(busyInsights());
    await renderInsights('mobile');
    expect(screen.queryByRole('button', { name: /^Ask Pip/ })).toBeNull();
  });

  it('keeps incident links inside the mobile shell on the mobile route', async () => {
    loader.insights.mockResolvedValue(busyInsights());
    await renderInsights('mobile');
    expect(screen.getByTestId('host')).toHaveAttribute('data-presentation', 'mobile');
    expect(
      screen.getByRole('link', { name: 'Checkout pool exhausted (last month)' })
    ).toHaveAttribute('href', '/m/incidents/inc-old');
    expect(screen.getByRole('link', { name: 'Database failover' })).toHaveAttribute(
      'href',
      '/m/incidents/inc-up'
    );
  });

  it('points the inspector’s runbooks at the Runbooks tab instead of duplicating the launcher', async () => {
    loader.insights.mockResolvedValue(busyInsights());
    await renderInsights();
    const runbooks = screen.getByRole('region', { name: 'Runbooks that have worked here' });
    expect(
      within(runbooks).getByText('Succeeded 3 of 4 completed runs on this service (75%)')
    ).toBeInTheDocument();
    expect(
      within(runbooks).getByRole('link', { name: 'Run one from the Runbooks tab' })
    ).toHaveAttribute('href', '#runbook-suggested');
    expect(within(runbooks).queryByRole('button', { name: 'Run on this incident' })).toBeNull();
  });

  it('lets a manager refresh a current analysis from the inspector, where the strip has no dot', async () => {
    loader.insights.mockResolvedValue(
      busyInsights({
        canManage: true,
        analysis: {
          status: 'CURRENT',
          message: 'Recommendations checked.',
          canRefresh: true,
          diagnosticsHref: '/settings/intelligence',
        },
      })
    );
    await renderInsights();
    const groups = screen.getAllByRole('group', { name: 'Recommendation freshness' });
    expect(groups).toHaveLength(1);
    expect(
      within(groups[0]).getByRole('button', { name: 'Refresh recommendations' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('intelligence-strip')).not.toContainElement(groups[0]);
  });

  it('puts unfinished analysis on the strip as the one freshness dot', async () => {
    loader.insights.mockResolvedValue(
      quietInsights({
        analysis: { status: 'WAITING', message: 'Waiting for analysis.', canRefresh: false },
      })
    );
    await renderInsights();
    const groups = screen.getAllByRole('group', { name: 'Recommendation freshness' });
    expect(groups).toHaveLength(1);
    expect(screen.getByTestId('intelligence-strip')).toContainElement(groups[0]);
    // Opened with nothing to show, the inspector explains why rather than showing empty cards.
    expect(
      within(screen.getByTestId('host')).getByText('Waiting for analysis.')
    ).toBeInTheDocument();
  });

  it('OFF mode, manager: no strip, one hint, and only links that can still be undone', async () => {
    loader.insights.mockResolvedValue(
      busyInsights({
        mode: 'OFF',
        canManage: true,
        analysis: null,
        proactive: null,
        triage: null,
        similar: null,
        response: null,
        impact: null,
        noise: [],
        group: null,
        ai: { summaryEnabled: false },
        squire: { enabled: false, mobileEnabled: false, name: 'Squire' },
      })
    );
    await renderInsights();
    expect(screen.queryByTestId('intelligence-strip')).toBeNull();
    expect(screen.getByTestId('insights-off-hint')).toHaveTextContent(
      'Intelligence is off for this service'
    );
    expect(screen.getByRole('link', { name: 'Open intelligence settings' })).toHaveAttribute(
      'href',
      '/settings/intelligence'
    );
    expect(
      screen.getAllByRole('region').map(region => region.getAttribute('aria-labelledby'))
    ).toEqual(['related-incidents-heading']);
  });
});

describe('IncidentGroupLine', () => {
  it('summarises a storm parent in one line that opens the group in the inspector', async () => {
    loader.insights.mockResolvedValue(busyInsights());
    render(<>{await IncidentGroupLine({ incidentId: 'inc-1' })}</>);
    const line = screen.getByTestId('incident-group-line');
    expect(line).toHaveTextContent('Parent of 1 grouped incident and 1 grouped alert');
    const view = within(line).getByRole('link', { name: 'View group' });
    expect(view).toHaveAttribute('data-insights-open', 'related');
    expect(view).toHaveAttribute('href', '?insights=related');
  });

  it('links a child to its parent, and says so when the parent is not readable', async () => {
    const group = busyInsights().group!;
    loader.insights.mockResolvedValue(
      busyInsights({
        group: {
          ...group,
          role: 'CHILD',
          parent: {
            id: 'inc-parent',
            ref: '#ARENT',
            title: 'Database storm',
            status: 'OPEN',
            createdAt: new Date(),
          },
        },
      })
    );
    const first = render(
      <>{await IncidentGroupLine({ incidentId: 'inc-1', presentation: 'mobile' })}</>
    );
    expect(screen.getByRole('link', { name: '#ARENT Database storm' })).toHaveAttribute(
      'href',
      '/m/incidents/inc-parent'
    );
    first.unmount();

    loader.insights.mockResolvedValue(
      busyInsights({
        group: { ...group, role: 'CHILD', parent: null, parentHidden: true, members: [] },
      })
    );
    render(<>{await IncidentGroupLine({ incidentId: 'inc-1' })}</>);
    expect(screen.getByTestId('incident-group-line')).toHaveTextContent(
      'Grouped under a parent incident you cannot view'
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('respects the service mode: no line in OFF, and none for an ungrouped incident', async () => {
    loader.insights.mockResolvedValue(busyInsights({ mode: 'OFF', canManage: true }));
    expect(await IncidentGroupLine({ incidentId: 'inc-1' })).toBeNull();
    loader.insights.mockResolvedValue(quietInsights());
    expect(await IncidentGroupLine({ incidentId: 'inc-1' })).toBeNull();
  });
});

describe('SuggestedRunbooks', () => {
  it('lists recommended runbooks with their success rate and a launcher', async () => {
    loader.insights.mockResolvedValue(busyInsights());
    render(<>{await SuggestedRunbooks({ incidentId: 'inc-1' })}</>);
    const group = screen.getByRole('region', { name: 'Suggested for this incident' });
    expect(group).toHaveAttribute('id', 'runbook-suggested');
    expect(within(group).getByRole('link', { name: 'Restart pool' })).toHaveAttribute(
      'href',
      '/runbooks/rb-1'
    );
    expect(
      within(group).getByText('Succeeded 3 of 4 completed runs on this service (75%)')
    ).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Run on this incident' })).toHaveAttribute(
      'data-runbook',
      'rb-1'
    );
  });

  it('shows no launcher to a viewer who may not execute, and nothing without recommendations or in OFF', async () => {
    loader.insights.mockResolvedValue(busyInsights({ canExecuteRunbooks: false }));
    const first = render(<>{await SuggestedRunbooks({ incidentId: 'inc-1' })}</>);
    expect(screen.queryByRole('button', { name: 'Run on this incident' })).toBeNull();
    first.unmount();
    loader.insights.mockResolvedValue(quietInsights());
    expect(await SuggestedRunbooks({ incidentId: 'inc-1' })).toBeNull();
    loader.insights.mockResolvedValue(busyInsights({ mode: 'OFF' }));
    expect(await SuggestedRunbooks({ incidentId: 'inc-1' })).toBeNull();
  });
});

describe('IncidentTimelineWithIntelligence', () => {
  const onset = new Date('2026-11-01T10:00:00Z');
  const core = {
    incidentId: 'inc-1',
    events: [{ id: 'e1', message: 'Escalated to level 2', type: 'ESCALATION', createdAt: onset }],
    incidentCreatedAt: onset,
  };

  it('adds the readable intelligence events to the core timeline', async () => {
    loader.insights.mockResolvedValue(busyInsights());
    loader.axis.mockResolvedValue({
      onset,
      truncated: false,
      canReverse: false,
      entries: [
        {
          kind: 'CHANGE',
          at: new Date(onset.getTime() - 60_000),
          title: 'deploy api v9',
          detail: 'deploy · ci',
          href: '/changes/chg-1',
          offsetMinutes: -1,
        },
      ],
    });
    const { container } = render(<>{await IncidentTimelineWithIntelligence(core)}</>);
    expect(
      [...container.querySelectorAll<HTMLElement>('[data-intelligence-kind]')].map(
        row => row.dataset.intelligenceKind
      )
    ).toEqual(['CHANGE', 'BRIEFING']);
    expect(screen.getByText('Escalated to level 2')).toBeInTheDocument();
  });

  it('is the plain core timeline when the axis is unavailable', async () => {
    loader.insights.mockResolvedValue(busyInsights());
    loader.axis.mockResolvedValue(null);
    render(<>{await IncidentTimelineWithIntelligence(core)}</>);
    expect(screen.queryByRole('checkbox', { name: /Show intelligence events/ })).toBeNull();
    expect(screen.getByText('Escalated to level 2')).toBeInTheDocument();
  });
});
