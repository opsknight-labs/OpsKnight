import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const reverse = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/incidents/[id]/noise-actions', () => ({
  reverseIncidentNoiseDecision: reverse,
}));
vi.mock('@/app/(app)/incidents/[id]/intelligence-actions', () => ({
  decideRelatedIncident: vi.fn(),
}));
vi.mock('@/components/incident/detail/actions', () => ({
  loadOlderIncidentTimelineActivity: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import IncidentTimeline from '@/components/incident/detail/IncidentTimeline';
import { toIntelligenceTimelineEvents } from '@/lib/intelligence/incident-ux/timeline-overlay';
import type { IncidentTimeAxis } from '@/lib/intelligence/timeline/service';

const onset = new Date('2026-11-01T10:00:00Z');

function axis(canReverse: boolean): IncidentTimeAxis {
  return {
    onset,
    truncated: false,
    canReverse,
    entries: [
      {
        kind: 'INCIDENT',
        at: onset,
        title: 'Incident opened: Checkout down',
        detail: null,
        href: null,
        offsetMinutes: 0,
      },
      {
        kind: 'CHANGE',
        at: new Date(onset.getTime() - 12 * 60_000),
        title: 'Deploy api v9',
        detail: 'deploy · ci · Checkout',
        href: 'https://ci.example.test/run/9',
        offsetMinutes: -12,
        riskPercent: 64,
      },
      {
        kind: 'NOISE_DECISION',
        at: new Date(onset.getTime() + 3 * 60_000),
        title: 'Suppressed by rule “Known noisy probe”',
        detail: 'on mode',
        href: '/alerts/a-1',
        offsetMinutes: 3,
        why: ['Matched label probe=synthetic', 'Threshold: 3'],
        reversed: false,
        reversal: canReverse ? { decisionId: 'dec-1', pages: true } : null,
      },
      {
        kind: 'NOISE_DECISION',
        at: new Date(onset.getTime() + 4 * 60_000),
        title: 'In maintenance window “DB upgrade”',
        detail: 'on mode · reversed',
        href: null,
        offsetMinutes: 4,
        why: ['Window active', 'An operator reversed this decision.'],
        reversed: true,
        reversal: null,
      },
      {
        kind: 'GROUPING',
        at: new Date(onset.getTime() + 5 * 60_000),
        title: 'Grouped into parent #BBBBB Database storm',
        detail: 'Grouping accepted automatically',
        href: '/incidents/parent-bbbbb',
        offsetMinutes: 5,
      },
      {
        kind: 'SUGGESTION',
        at: new Date(onset.getTime() + 6 * 60_000),
        title: 'Related link to an incident you cannot view rejected',
        detail: 'Suggestion rejected by Dana',
        href: null,
        offsetMinutes: 6,
      },
      {
        kind: 'TRIAGE',
        at: new Date(onset.getTime() + 7 * 60_000),
        title: 'Triage suggestion for urgency (high) accepted',
        detail: 'by Dana',
        href: null,
        offsetMinutes: 7,
      },
    ],
  };
}

const core = [{ id: 'e1', message: 'Escalated to level 2', type: 'ESCALATION', createdAt: onset }];

const rows = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('[data-intelligence-kind]'),
];

function renderTimeline(canReverse = false, withBriefing = false) {
  return render(
    <IncidentTimeline
      incidentId="inc-1"
      events={core}
      incidentCreatedAt={onset}
      intelligenceEvents={toIntelligenceTimelineEvents(
        axis(canReverse),
        withBriefing ? { createdAt: new Date(onset.getTime() + 60_000), mode: 'BASIC' } : null
      )}
    />
  );
}

describe('toIntelligenceTimelineEvents', () => {
  it('drops the axis’ own lifecycle entries and keeps every intelligence kind in time order', () => {
    const events = toIntelligenceTimelineEvents(axis(false));
    expect(events.map(event => event.kind)).toEqual([
      'CHANGE',
      'NOISE_DECISION',
      'NOISE_DECISION',
      'GROUPING',
      'SUGGESTION',
      'TRIAGE',
    ]);
    expect(new Set(events.map(event => event.id)).size).toBe(events.length);
    expect(events[0]).toMatchObject({ offsetMinutes: -12, riskPercent: 64 });
  });

  it('adds the briefing as a row that opens its inspector section, and is empty without an axis', () => {
    const at = new Date(onset.getTime() + 60_000);
    const events = toIntelligenceTimelineEvents(axis(false), { createdAt: at, mode: 'AI' });
    expect(events.find(event => event.kind === 'BRIEFING')).toMatchObject({
      insightsSection: 'briefing',
      href: '?insights=briefing',
      detail: 'Written with AI',
      offsetMinutes: 1,
    });
    expect(toIntelligenceTimelineEvents(null, { createdAt: at, mode: 'AI' })).toEqual([]);
  });
});

describe('core timeline with intelligence events', () => {
  it('merges intelligence rows into the core timeline, on by default, with their why and links', () => {
    const { container } = renderTimeline();
    const toggle = screen.getByRole('checkbox', { name: /Show intelligence events/ });
    expect(toggle).toBeChecked();
    const items = rows(container);
    expect(items.map(item => item.dataset.intelligenceKind)).toEqual([
      'CHANGE',
      'NOISE_DECISION',
      'NOISE_DECISION',
      'GROUPING',
      'SUGGESTION',
      'TRIAGE',
    ]);
    // A change before onset sorts ahead of the incident's own creation event.
    expect(items[0]).toHaveTextContent('12 min before · deploy · ci · Checkout');
    expect(items[0]).toHaveTextContent('risk 64%');
    expect(within(items[0]).getByRole('link', { name: 'Deploy api v9' })).toHaveAttribute(
      'target',
      '_blank'
    );
    expect(items[1]).toHaveTextContent('Noise control');
    expect(items[1]).toHaveTextContent('3 min after · on mode');
    expect(within(items[1]).getByRole('link', { name: /Suppressed by rule/ })).toHaveAttribute(
      'href',
      '/alerts/a-1'
    );
    // "Why?" is a native disclosure: keyboard reachable, collapsed by default.
    const why = within(items[1]).getByText('Why?');
    expect(why.tagName).toBe('SUMMARY');
    expect(within(items[1]).getByText('Matched label probe=synthetic')).toBeInTheDocument();
    expect(items[3]).toHaveTextContent('5 min after');
    expect(within(items[3]).getByRole('link')).toHaveAttribute('href', '/incidents/parent-bbbbb');
    expect(within(items[4]).queryByRole('link')).not.toBeInTheDocument();
    expect(items[5]).toHaveTextContent('Triage suggestion for urgency (high) accepted');
    // Core rows are still there, in the same list.
    expect(screen.getByText('Escalated to level 2')).toBeInTheDocument();
  });

  it('hides every intelligence row and its filter when the toggle is switched off', () => {
    const { container } = renderTimeline();
    expect(screen.getByRole('button', { name: 'Intelligence' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Show intelligence events/ }));
    expect(rows(container)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Intelligence' })).not.toBeInTheDocument();
    expect(screen.getByText('Escalated to level 2')).toBeInTheDocument();
  });

  it('filters down to intelligence events only', () => {
    const { container } = renderTimeline();
    fireEvent.click(screen.getByRole('button', { name: 'Intelligence' }));
    expect(rows(container)).toHaveLength(6);
    expect(screen.queryByText('Escalated to level 2')).not.toBeInTheDocument();
    // Switching intelligence off while its filter is selected falls back to the full core timeline.
    fireEvent.click(screen.getByRole('checkbox', { name: /Show intelligence events/ }));
    expect(screen.getByText('Escalated to level 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders no toggle and no filter when there are no intelligence events', () => {
    render(<IncidentTimeline incidentId="inc-1" events={core} incidentCreatedAt={onset} />);
    expect(screen.queryByRole('checkbox', { name: /Show intelligence events/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Intelligence' })).toBeNull();
    expect(document.getElementById('timeline-intelligence')).toBeNull();
  });

  it('gives the strip’s noise chip an anchor to land on', () => {
    renderTimeline();
    expect(document.getElementById('timeline-intelligence')).not.toBeNull();
  });

  it('links the briefing row to its inspector section', () => {
    const { container } = renderTimeline(false, true);
    const briefing = rows(container).find(row => row.dataset.intelligenceKind === 'BRIEFING')!;
    expect(within(briefing).getByRole('link')).toHaveAttribute('data-insights-open', 'briefing');
  });

  it('offers no reversal to viewers who may not reverse', () => {
    renderTimeline(false);
    expect(screen.queryByRole('button', { name: /Reverse/ })).not.toBeInTheDocument();
  });

  it('lets a manager reverse an unreversed decision after confirming', async () => {
    reverse.mockResolvedValue({
      ok: true,
      done: true,
      message: 'Reversed.',
      pagedIncidentId: null,
    });
    renderTimeline(true);
    const buttons = screen.getAllByRole('button', { name: 'Reverse and page' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('alertdialog', {}, { timeout: 5_000 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reverse and page' }));
    await waitFor(() => expect(reverse).toHaveBeenCalledTimes(1));
    expect(reverse.mock.calls[0][0]).toBe('inc-1');
    expect((reverse.mock.calls[0][2] as FormData).get('decisionId')).toBe('dec-1');
  });
});
