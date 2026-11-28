import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostmortemDetailView from '@/components/postmortem/PostmortemDetailView';
import { deriveJiraCapability } from '@/lib/jira-capabilities';
import { togglePostmortemPublicStatus } from '@/app/(app)/postmortems/actions';
import { notify } from '@/lib/toast';

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));
vi.mock('@/app/(app)/postmortems/actions', () => ({
  togglePostmortemPublicStatus: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const jiraCapability = deriveJiraCapability({
  workspaceState: 'ENABLED',
  canManage: true,
  serviceMapped: true,
  syncEnabled: true,
  rawEnabled: true,
});

function renderView(status: string, isPublic: boolean) {
  render(
    <PostmortemDetailView
      postmortem={{
        id: 'pm-1',
        title: 'DB outage',
        status,
        isPublic,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        createdBy: null,
        incident: { id: 'inc-1', title: 'DB down' },
      }}
      canEdit
      incidentId="inc-1"
      jiraCapability={jiraCapability}
    />
  );
}

describe('postmortem status page visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only says Public on Status Page once the postmortem is published', () => {
    renderView('DRAFT', true);
    expect(screen.queryByText('Public on Status Page')).not.toBeInTheDocument();
    expect(screen.getByText('Public once published')).toBeInTheDocument();
  });

  it('says Public on Status Page for a published, public postmortem', () => {
    renderView('PUBLISHED', true);
    expect(screen.getByText('Public on Status Page')).toBeInTheDocument();
  });

  it('does not offer to publish a draft that only the status flag can change', () => {
    renderView('DRAFT', false);
    expect(screen.getByText('Internal Only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /allow on status page/i })).toBeInTheDocument();
  });

  it('shows the reason and keeps the previous state when the toggle fails', async () => {
    vi.mocked(togglePostmortemPublicStatus).mockResolvedValue({
      success: false,
      error: 'Forbidden: You do not have permission to change this postmortem',
    });
    renderView('PUBLISHED', false);

    fireEvent.click(screen.getByRole('button', { name: /publish to status page/i }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Forbidden: You do not have permission to change this postmortem'
      )
    );
    expect(screen.getByText('Internal Only')).toBeInTheDocument();
  });
});
