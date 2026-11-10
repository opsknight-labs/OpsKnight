import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ reverse: vi.fn(), decide: vi.fn() }));
vi.mock('@/app/(app)/incidents/[id]/noise-actions', () => ({
  reverseIncidentNoiseDecision: actions.reverse,
}));
vi.mock('@/app/(app)/incidents/[id]/intelligence-actions', () => ({
  decideRelatedIncident: actions.decide,
}));

import IncidentGroupView from '@/components/incident/intelligence/IncidentGroupView';
import type { IncidentGroupView as GroupView } from '@/lib/intelligence/incident-ux/group-view';

const onset = new Date('2026-11-01T10:00:00Z');
const at = (minutes: number) => new Date(onset.getTime() + minutes * 60_000);

function parentGroup(overrides: Partial<GroupView> = {}): GroupView {
  return {
    role: 'PARENT',
    parent: null,
    parentHidden: false,
    anchorOnset: onset,
    hiddenMembers: 0,
    truncated: false,
    canUngroupAlerts: true,
    canUngroupIncidents: true,
    members: [
      {
        kind: 'INCIDENT',
        id: 'child-incident-aaaaa',
        ref: '#AAAAA',
        title: 'Checkout 502s',
        status: 'OPEN',
        at: at(2),
        relationshipId: 'rel-1',
        automatic: true,
        current: false,
      },
      {
        kind: 'ALERT',
        decisionId: 'dec-1',
        alertId: 'alert-1',
        title: 'db-1 CPU high',
        at: at(5),
        ungroupable: true,
        reversed: false,
      },
      {
        kind: 'ALERT',
        decisionId: 'dec-2',
        alertId: 'alert-2',
        title: 'db-2 CPU high',
        at: at(7),
        ungroupable: false,
        reversed: true,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  actions.reverse.mockReset();
  actions.decide.mockReset();
});

describe('IncidentGroupView', () => {
  it('lists grouped incidents and alerts on a mini timeline relative to the parent onset', () => {
    render(<IncidentGroupView incidentId="parent-1" group={parentGroup()} />);
    expect(
      screen.getByRole('heading', { name: 'Grouped under this incident' })
    ).toBeInTheDocument();
    expect(screen.getByText(/1 incident and 2 alerts grouped here/)).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Mini timeline: 1 incident and 2 alerts/ })
    ).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Grouped incidents and alerts' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('+2 min');
    expect(within(items[0]).getByRole('link', { name: '#AAAAA Checkout 502s' })).toHaveAttribute(
      'href',
      '/incidents/child-incident-aaaaa'
    );
    expect(items[1]).toHaveTextContent('+5 min');
    expect(within(items[1]).getByRole('button', { name: 'Ungroup and page' })).toBeInTheDocument();
    // A reversed alert is marked and offers no second reversal.
    expect(items[2]).toHaveTextContent('ungrouped');
    expect(within(items[2]).queryByRole('button')).not.toBeInTheDocument();
  });

  it('asks for confirmation before ungrouping and paging, then announces the result', async () => {
    actions.reverse.mockResolvedValue({
      ok: true,
      done: true,
      pagedIncidentId: 'new-incident',
      message: 'Ungrouped. The alert was re-ingested as its own incident and pages normally.',
    });
    render(<IncidentGroupView incidentId="parent-1" group={parentGroup()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup and page' }));
    const dialog = await screen.findByRole('alertdialog', {}, { timeout: 5_000 });
    expect(dialog).toHaveTextContent('pages the on-call responder');
    expect(actions.reverse).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ungroup and page' }));
    await waitFor(() => expect(actions.reverse).toHaveBeenCalledTimes(1));
    expect(actions.reverse.mock.calls[0][0]).toBe('parent-1');
    expect((actions.reverse.mock.calls[0][2] as FormData).get('decisionId')).toBe('dec-1');
    const announced = await screen.findByText(/pages normally/, {}, { timeout: 5_000 });
    expect(announced).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('link', { name: 'Open the new incident' })).toHaveAttribute(
      'href',
      '/incidents/new-incident'
    );
  });

  it('keeps the result and the new-incident link after the server refresh marks the alert reversed', async () => {
    actions.reverse.mockResolvedValue({
      ok: true,
      done: true,
      pagedIncidentId: 'new-incident',
      message: 'Ungrouped. The alert was re-ingested as its own incident and pages normally.',
    });
    const { rerender } = render(<IncidentGroupView incidentId="parent-1" group={parentGroup()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup and page' }));
    const dialog = await screen.findByRole('alertdialog', {}, { timeout: 5_000 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ungroup and page' }));
    await screen.findByText(/pages normally/, {}, { timeout: 5_000 });

    // revalidatePath re-renders the server component: the alert is now reversed, not ungroupable.
    const refreshed = parentGroup();
    refreshed.members = refreshed.members.map(member =>
      member.kind === 'ALERT' && member.decisionId === 'dec-1'
        ? { ...member, ungroupable: false, reversed: true }
        : member
    );
    rerender(<IncidentGroupView incidentId="parent-1" group={refreshed} />);
    expect(screen.getByText(/pages normally/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the new incident' })).toHaveAttribute(
      'href',
      '/incidents/new-incident'
    );
    expect(screen.queryByRole('button', { name: 'Ungroup and page' })).not.toBeInTheDocument();
  });

  it('cancelling the dialog changes nothing', async () => {
    render(<IncidentGroupView incidentId="parent-1" group={parentGroup()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup and page' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }, { timeout: 5_000 }));
    expect(actions.reverse).not.toHaveBeenCalled();
  });

  it('removes a child incident through the relationship decision', async () => {
    actions.decide.mockResolvedValue({ ok: true, message: 'Link removed.', decision: 'REVERTED' });
    render(<IncidentGroupView incidentId="parent-1" group={parentGroup()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup' }));
    const dialog = await screen.findByRole('alertdialog', {}, { timeout: 5_000 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ungroup' }));
    await waitFor(() => expect(actions.decide).toHaveBeenCalledTimes(1));
    const form = actions.decide.mock.calls[0][2] as FormData;
    expect(form.get('relationshipId')).toBe('rel-1');
    expect(form.get('decision')).toBe('REVERTED');
  });

  it('hides ungroup controls from viewers without the permission', () => {
    render(
      <IncidentGroupView
        incidentId="parent-1"
        group={parentGroup({ canUngroupAlerts: false, canUngroupIncidents: false })}
      />
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('links a child to its parent and marks the viewed incident', () => {
    render(
      <IncidentGroupView
        incidentId="child-incident-aaaaa"
        group={parentGroup({
          role: 'CHILD',
          parent: {
            id: 'parent-incident-bbbbb',
            ref: '#BBBBB',
            title: 'Database storm',
            status: 'ACKNOWLEDGED',
            createdAt: onset,
          },
          members: [{ ...parentGroup().members[0], current: true } as GroupView['members'][0]],
        })}
      />
    );
    expect(screen.getByRole('link', { name: '#BBBBB Database storm' })).toHaveAttribute(
      'href',
      '/incidents/parent-incident-bbbbb'
    );
    expect(screen.getByText(/\(this incident\)/)).toHaveAttribute('aria-current', 'page');
  });

  it('says only that a parent exists when the viewer may not read it', () => {
    render(
      <IncidentGroupView
        incidentId="child-1"
        group={parentGroup({ role: 'CHILD', parentHidden: true, members: [] })}
      />
    );
    expect(screen.getByText(/parent incident you do not have access to/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
