import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostmortemForm from '@/components/PostmortemForm';
import { deriveJiraCapability } from '@/lib/jira-capabilities';
import { upsertPostmortem } from '@/app/(app)/postmortems/actions';

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
  suggestForActionItemDraftAction: vi.fn().mockResolvedValue(null),
}));

const jiraCapability = deriveJiraCapability({
  workspaceState: 'ENABLED',
  canManage: true,
  serviceMapped: true,
  syncEnabled: true,
  rawEnabled: true,
});

describe('PostmortemForm saves what the API can store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(upsertPostmortem).mockResolvedValue({ success: true } as never);
  });

  it('saves a 150-character title on a postmortem that is in review', async () => {
    const title = 'T'.repeat(150);
    render(
      <PostmortemForm
        incidentId="inc-1"
        initialData={{ id: 'pm-1', revision: 3, title, summary: 'Summary', status: 'IN_REVIEW' }}
        jiraCapability={jiraCapability}
        resolvedIncidents={[
          { id: 'inc-1', title: 'DB down', resolvedAt: null, service: { name: 'Database' } },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /update postmortem/i }));

    await waitFor(() => expect(upsertPostmortem).toHaveBeenCalledTimes(1));
    expect(upsertPostmortem).toHaveBeenCalledWith(
      'inc-1',
      expect.objectContaining({ title, status: 'IN_REVIEW' })
    );
  });
});
