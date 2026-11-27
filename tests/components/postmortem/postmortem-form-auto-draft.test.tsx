import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostmortemForm from '@/components/PostmortemForm';
import { deriveJiraCapability } from '@/lib/jira-capabilities';
import { generatePostmortemDraft } from '@/app/(app)/postmortems/actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));
vi.mock('@/lib/toast', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/app/(app)/postmortems/actions', () => ({
  upsertPostmortem: vi.fn(),
  generatePostmortemDraft: vi.fn(),
}));
vi.mock('@/app/(app)/postmortems/ai-actions', () => ({ draftPostmortemWithAiAction: vi.fn() }));
vi.mock('@/app/(app)/postmortems/intelligence-actions', () => ({
  getPostmortemAssistAction: vi.fn().mockResolvedValue(null),
}));

const jiraCapability = deriveJiraCapability({
  workspaceState: 'ENABLED',
  canManage: true,
  serviceMapped: true,
  syncEnabled: true,
  rawEnabled: true,
});

const draft = {
  summary: 'Generated summary',
  rootCause: 'Generated root cause',
  resolution: 'Generated resolution',
  lessons: 'Generated lessons',
  timeline: [],
  impact: {},
};

function renderForm(initialData?: { id: string; title: string; summary?: string }) {
  render(
    <PostmortemForm
      incidentId="inc-1"
      initialData={initialData}
      jiraCapability={jiraCapability}
      resolvedIncidents={[
        { id: 'inc-1', title: 'DB down', resolvedAt: null, service: { name: 'Database' } },
      ]}
    />
  );
}

describe('PostmortemForm Auto-Draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generatePostmortemDraft).mockResolvedValue(draft as never);
  });

  it('drafts straight away when nothing has been written', async () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: /auto-draft/i }));

    await waitFor(() => expect(generatePostmortemDraft).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Replace what you have written?')).not.toBeInTheDocument();
  });

  it('asks before replacing content, and keeps it when the user declines', async () => {
    renderForm({ id: 'pm-1', title: 'DB outage', summary: 'My own summary' });

    fireEvent.click(screen.getByRole('button', { name: /auto-draft/i }));
    fireEvent.click(await screen.findByRole('button', { name: /keep my content/i }));

    expect(generatePostmortemDraft).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('My own summary')).toBeInTheDocument();
  });

  it('replaces the content once the user confirms', async () => {
    renderForm({ id: 'pm-1', title: 'DB outage', summary: 'My own summary' });

    fireEvent.click(screen.getByRole('button', { name: /auto-draft/i }));
    fireEvent.click(await screen.findByRole('button', { name: /replace with draft/i }));

    await waitFor(() => expect(generatePostmortemDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByDisplayValue('Generated summary')).toBeInTheDocument());
  });
});
