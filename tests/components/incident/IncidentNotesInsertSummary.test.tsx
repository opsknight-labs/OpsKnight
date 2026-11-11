import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));
vi.mock('@/components/incident/detail/actions', () => ({ loadOlderIncidentNotes: vi.fn() }));

const summarize = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: vi.fn(async () => ({})) }));
vi.mock('@/lib/intelligence/drafts/service', () => ({ summarizeIncident: summarize }));
vi.mock('@/lib/intelligence/feedback/service', () => ({
  revokeFeedback: vi.fn(),
  submitFeedback: vi.fn(),
}));
vi.mock('@/lib/intelligence/correlation/commands', () => ({
  decideRelationship: vi.fn(),
  linkIncidents: vi.fn(),
}));

import IncidentNotes from '@/components/incident/detail/IncidentNotes';
import { draftIncidentSummaryNoteAction } from '@/app/(app)/incidents/[id]/intelligence-actions';
import { formatSummaryAsNote } from '@/lib/intelligence/incident-ux/summary-note';

const summary = {
  headline: 'Checkout is failing after the v9 deploy',
  currentState: 'Errors started 7 minutes after the deploy.',
  impact: 'Customers cannot pay.',
  keyEvents: ['10:00 incident opened'],
  possibleCauses: ['Bad config in v9'],
  nextSteps: ['Roll back v9'],
};

const composer = () => screen.getByPlaceholderText(/Type a note/) as HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('note composer: Insert summary', () => {
  it('is absent unless the page offers a summary draft', () => {
    render(<IncidentNotes incidentId="inc-1" notes={[]} canManage onAddNote={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Insert summary' })).toBeNull();
  });

  it('is absent for a viewer who cannot add notes', () => {
    render(
      <IncidentNotes
        incidentId="inc-1"
        notes={[]}
        canManage={false}
        onAddNote={vi.fn()}
        onDraftSummary={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Insert summary' })).toBeNull();
  });

  it('inserts the draft for editing and never posts it on its own', async () => {
    const onAddNote = vi.fn();
    const onDraftSummary = vi.fn(async () => ({ ok: true as const, text: 'Summary: all good' }));
    render(
      <IncidentNotes
        incidentId="inc-1"
        notes={[]}
        canManage
        onAddNote={onAddNote}
        onDraftSummary={onDraftSummary}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Insert summary' }));
    await waitFor(() => expect(composer().value).toBe('Summary: all good'));
    expect(onDraftSummary).toHaveBeenCalledTimes(1);
    expect(onAddNote).not.toHaveBeenCalled();
  });

  it('appends to a note in progress instead of replacing it', async () => {
    render(
      <IncidentNotes
        incidentId="inc-1"
        notes={[]}
        canManage
        onAddNote={vi.fn()}
        onDraftSummary={async () => ({ ok: true, text: 'Summary: all good' })}
      />
    );
    fireEvent.change(composer(), { target: { value: 'Paged the DBA.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert summary' }));
    await waitFor(() => expect(composer().value).toBe('Paged the DBA.\n\nSummary: all good'));
  });

  it('keeps the draft and explains when a summary cannot be written', async () => {
    render(
      <IncidentNotes
        incidentId="inc-1"
        notes={[]}
        canManage
        onAddNote={vi.fn()}
        onDraftSummary={async () => ({ ok: false, message: 'AI summaries are unavailable.' })}
      />
    );
    fireEvent.change(composer(), { target: { value: 'Paged the DBA.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert summary' }));
    expect(await screen.findByText('AI summaries are unavailable.')).toBeInTheDocument();
    expect(composer().value).toBe('Paged the DBA.');
  });
});

describe('draftIncidentSummaryNoteAction', () => {
  it('uses the summary action and the same note format as "Post summary as note"', async () => {
    summarize.mockResolvedValue({ ok: true, value: summary, model: 'model-x', promptVersion: 3 });
    const draft = await draftIncidentSummaryNoteAction('inc-1');
    expect(summarize).toHaveBeenCalledWith({}, 'inc-1');
    expect(draft).toEqual({
      ok: true,
      text: formatSummaryAsNote(summary, { kind: 'ai', model: 'model-x' }),
    });
  });

  it('returns the readable reason when no summary can be generated', async () => {
    summarize.mockResolvedValue({ ok: false, reason: 'UNAVAILABLE' });
    const draft = await draftIncidentSummaryNoteAction('inc-1');
    expect(draft.ok).toBe(false);
    expect(draft).toHaveProperty('message');
    summarize.mockRejectedValue(new Error('provider down'));
    expect((await draftIncidentSummaryNoteAction('inc-1')).ok).toBe(false);
  });
});
