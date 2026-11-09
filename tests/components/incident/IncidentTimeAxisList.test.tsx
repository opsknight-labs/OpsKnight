import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const reverse = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/incidents/[id]/noise-actions', () => ({
  reverseIncidentNoiseDecision: reverse,
}));
vi.mock('@/app/(app)/incidents/[id]/intelligence-actions', () => ({
  decideRelatedIncident: vi.fn(),
}));

import IncidentTimeAxisList from '@/components/incident/intelligence/IncidentTimeAxisList';
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

describe('IncidentTimeAxisList', () => {
  it('renders noise decisions with their why, grouping and suggestion decisions', () => {
    render(<IncidentTimeAxisList incidentId="inc-1" axis={axis(false)} />);
    const list = screen.getByRole('list', { name: 'Incident time axis' });
    const items = within(list)
      .getAllByRole('listitem')
      .filter(li => li.dataset.kind);
    expect(items.map(item => item.dataset.kind)).toEqual([
      'INCIDENT',
      'NOISE_DECISION',
      'NOISE_DECISION',
      'GROUPING',
      'SUGGESTION',
      'TRIAGE',
    ]);
    expect(items[1]).toHaveTextContent('Noise control · 3 min after · on mode');
    expect(within(items[1]).getByRole('link', { name: /Suppressed by rule/ })).toHaveAttribute(
      'href',
      '/alerts/a-1'
    );
    // "Why?" is a native disclosure: keyboard reachable, collapsed by default.
    const why = within(items[1]).getByText('Why?');
    expect(why.tagName).toBe('SUMMARY');
    expect(within(items[1]).getByText('Matched label probe=synthetic')).toBeInTheDocument();
    expect(items[3]).toHaveTextContent('Grouping · 5 min after');
    expect(within(items[3]).getByRole('link')).toHaveAttribute('href', '/incidents/parent-bbbbb');
    expect(within(items[4]).queryByRole('link')).not.toBeInTheDocument();
    expect(items[5]).toHaveTextContent('Triage suggestion for urgency (high) accepted');
  });

  it('offers no reversal to viewers who may not reverse', () => {
    render(<IncidentTimeAxisList incidentId="inc-1" axis={axis(false)} />);
    expect(screen.queryByRole('button', { name: /Reverse/ })).not.toBeInTheDocument();
  });

  it('lets a manager reverse an unreversed decision after confirming', async () => {
    reverse.mockResolvedValue({
      ok: true,
      done: true,
      message: 'Reversed.',
      pagedIncidentId: null,
    });
    render(<IncidentTimeAxisList incidentId="inc-1" axis={axis(true)} />);
    const buttons = screen.getAllByRole('button', { name: 'Reverse and page' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reverse and page' }));
    await waitFor(() => expect(reverse).toHaveBeenCalledTimes(1));
    expect(reverse.mock.calls[0][0]).toBe('inc-1');
    expect((reverse.mock.calls[0][2] as FormData).get('decisionId')).toBe('dec-1');
  });
});
