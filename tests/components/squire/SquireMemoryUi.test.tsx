import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  saveSquireMemorySettingsAction: vi.fn(async () => ({ ok: true, message: 'Saved switch' })),
  saveSquireServicePolicyAction: vi.fn(async () => ({ ok: true, message: 'Saved policy' })),
  removeServiceFactAction: vi.fn(async () => ({ ok: true, message: 'Fact removed.' })),
}));
vi.mock('@/app/(app)/settings/intelligence/ai/memory/actions', () => actions);
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: vi.fn() }));
vi.mock('@/lib/intelligence/memory/proactive-view', () => ({
  getProactiveNotesForActor: vi.fn(),
}));

import {
  KnowledgeSwitchForm,
  ProactivePolicyForm,
  RemoveFactButton,
} from '@/components/settings/SquireMemoryForms';
import { ProactiveNotes } from '@/components/incident/IncidentSquireProactiveCard';
import type { ProactiveNotesView } from '@/lib/intelligence/memory/proactive-view';

const formOf = (mock: { mock: { calls: unknown[][] } }) =>
  (mock.mock.calls.at(-1) as unknown as [unknown, FormData])[1];

describe('Squire memory settings forms', () => {
  it('sends the knowledge switch with its revision, and is read-only without manage rights', async () => {
    const { unmount } = render(<KnowledgeSwitchForm enabled={false} revision={3} canManage />);
    const box = screen.getByRole('checkbox', { name: /Build Squire’s knowledge index/ });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.saveSquireMemorySettingsAction).toHaveBeenCalledTimes(1));
    const form = formOf(actions.saveSquireMemorySettingsAction);
    expect(form.get('knowledgeEnabled')).toBe('on');
    expect(form.get('expectedRevision')).toBe('3');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved switch');
    unmount();

    render(<KnowledgeSwitchForm enabled revision={1} canManage={false} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('defaults every proactive switch off and enables the minutes field only with the nudge', async () => {
    render(
      <ProactivePolicyForm
        canManage
        row={{
          serviceId: 'svc-1',
          briefingEnabled: false,
          nudgeAfterMinutes: null,
          postmortemDraftEnabled: false,
          revision: 0,
        }}
      />
    );
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    const minutes = screen.getByRole('spinbutton');
    expect(minutes).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Stakeholder-update nudge/ }));
    expect(minutes).toBeEnabled();
    fireEvent.change(minutes, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Briefing when an incident opens/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.saveSquireServicePolicyAction).toHaveBeenCalledTimes(1));
    const form = formOf(actions.saveSquireServicePolicyAction);
    expect(form.get('serviceId')).toBe('svc-1');
    expect(form.get('briefingEnabled')).toBe('on');
    expect(form.get('nudgeEnabled')).toBe('on');
    expect(form.get('nudgeAfterMinutes')).toBe('45');
    expect(form.get('postmortemDraftEnabled')).toBeNull();
    expect(form.get('expectedRevision')).toBe('0');
  });

  it('removes one fact by id and reports the result', async () => {
    render(<RemoveFactButton serviceId="svc-1" factId="fact-9" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(actions.removeServiceFactAction).toHaveBeenCalledTimes(1));
    const form = formOf(actions.removeServiceFactAction);
    expect(form.get('factId')).toBe('fact-9');
    expect(form.get('serviceId')).toBe('svc-1');
    expect(await screen.findByRole('status')).toHaveTextContent('Fact removed.');
  });
});

const refs = {
  similar: [{ id: 'inc-2', label: 'Checkout 500s', matchPercent: 82, resolution: null }],
  changes: [{ id: 'chg-1', label: 'Deploy api v42', minutesBefore: 7 }],
  runbooks: [{ id: 'rb-1', label: 'Restart api pods', succeeded: 3, eligible: 4 }],
};

const view = (overrides: Partial<ProactiveNotesView> = {}): ProactiveNotesView => ({
  briefing: {
    createdAt: new Date('2026-11-08T10:00:00Z'),
    mode: 'BASIC',
    headline: 'HIGH incident on api: Checkout failing',
    facts: ['Opened 4 minutes ago', '12 alerts so far'],
    analysisPending: false,
    refs,
    ai: null,
    nextSteps: ['Compare with Checkout 500s', 'Check the deploy api v42'],
  },
  nudge: null,
  postmortemDraft: null,
  ...overrides,
});

describe('Proactive Squire notes on the incident page', () => {
  it('renders a deterministic briefing with linked references and a basic-mode label', () => {
    render(<ProactiveNotes incidentId="inc-1" notes={view()} />);
    expect(screen.getByRole('heading', { name: 'Squire' })).toBeInTheDocument();
    expect(screen.getByText('Basic mode')).toBeInTheDocument();
    expect(screen.getByText('Opened 4 minutes ago')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Checkout 500s' })).toHaveAttribute(
      'href',
      '/incidents/inc-2'
    );
    expect(screen.getByRole('link', { name: 'Deploy api v42' })).toHaveAttribute(
      'href',
      '/changes/chg-1'
    );
    expect(screen.getByText('Likely change (unconfirmed)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Restart api pods' })).toBeInTheDocument();
    expect(screen.queryByText('Possible causes (to verify)')).toBeNull();
  });

  it('prefers AI text when present and labels it', () => {
    const base = view();
    render(
      <ProactiveNotes
        incidentId="inc-1"
        notes={view({
          briefing: {
            ...base.briefing!,
            mode: 'AI',
            ai: {
              headline: 'Checkout is failing after the v42 deploy',
              currentState: 'Errors started 7 minutes after the deploy.',
              possibleCauses: ['Bad config in v42'],
              nextSteps: ['Roll back v42'],
            },
          },
        })}
      />
    );
    expect(screen.getByText('Written with AI')).toBeInTheDocument();
    expect(screen.getByText('Checkout is failing after the v42 deploy')).toBeInTheDocument();
    expect(screen.getByText('Bad config in v42')).toBeInTheDocument();
    expect(screen.getByText('Roll back v42')).toBeInTheDocument();
    expect(screen.queryByText('Opened 4 minutes ago')).toBeNull();
  });

  it('shows the nudge with its draft and the postmortem draft as unpublished', () => {
    render(
      <ProactiveNotes
        incidentId="inc-1"
        notes={view({
          briefing: null,
          nudge: {
            updatedAt: new Date(),
            minutesSinceUpdate: 42,
            thresholdMinutes: 30,
            draft: 'We are investigating checkout errors.',
            aiDraft: null,
          },
          postmortemDraft: {
            createdAt: new Date(),
            mode: 'BASIC',
            summary: 'Checkout failed for 20 minutes.',
            impact: 'Customers could not pay.',
            rootCause: 'To be confirmed.',
            resolution: 'Rolled back.',
            lessons: 'Canary deploys.',
            actionItems: [{ title: 'Add canary', priority: 'HIGH' }],
            timeline: [],
            refs: { similar: [], changes: [], runbooks: [] },
          },
        })}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('No stakeholder update for 42 minutes.');
    expect(screen.getByText('We are investigating checkout errors.')).toBeInTheDocument();
    expect(screen.getByText(/not published/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the postmortem editor' })).toHaveAttribute(
      'href',
      '/postmortems/inc-1'
    );
  });
});
