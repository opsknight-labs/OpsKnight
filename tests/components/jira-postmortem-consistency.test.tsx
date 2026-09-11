import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PostmortemActionItems from '@/components/postmortem/PostmortemActionItems';
import ActionItemJiraBadge from '@/components/action-items/ActionItemJiraBadge';
import { normalizeLegacyActionItems } from '@/lib/action-items';
import { deriveJiraCapability } from '@/lib/jira-capabilities';
import {
  createJiraIssueFromActionItem,
  linkJiraIssueToActionItem,
  unlinkJiraIssueFromActionItem,
  syncActionItemJiraIssue,
} from '@/app/(app)/action-items/jira/actions';

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

vi.mock('@/app/(app)/action-items/jira/actions', () => ({
  createJiraIssueFromActionItem: vi.fn(),
  linkJiraIssueToActionItem: vi.fn(),
  unlinkJiraIssueFromActionItem: vi.fn(),
  syncActionItemJiraIssue: vi.fn(),
}));

const jiraCapability = deriveJiraCapability({
  workspaceState: 'ENABLED',
  canManage: true,
  serviceMapped: true,
  syncEnabled: true,
  rawEnabled: true,
});

const linkedIssue = {
  linkId: 'link-456',
  provider: 'JIRA',
  key: 'OPS-456',
  url: 'https://acme.atlassian.net/browse/OPS-456',
  status: 'In Progress',
  assignee: 'Responder',
  syncState: 'SYNCED',
};

describe('postmortem Jira action-item consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createJiraIssueFromActionItem).mockResolvedValue({ success: true });
    vi.mocked(linkJiraIssueToActionItem).mockResolvedValue({ success: true });
    vi.mocked(unlinkJiraIssueFromActionItem).mockResolvedValue({ success: true });
    vi.mocked(syncActionItemJiraIssue).mockResolvedValue({ success: true });
  });

  it('shows an existing Jira ticket instead of Create Jira after the postmortem boundary normalizes it', () => {
    const items = normalizeLegacyActionItems([
      {
        id: 'ai-postmortem-1-existing',
        title: 'Persisted follow-up',
        description: 'Already tracked in Jira',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        externalIssue: linkedIssue,
      },
    ]);

    render(
      <PostmortemActionItems
        actionItems={items}
        onChange={vi.fn()}
        users={[]}
        jiraCapability={jiraCapability}
      />
    );

    expect(screen.getByText('Persisted follow-up')).toBeInTheDocument();
    expect(screen.getByText('OPS-456')).toBeInTheDocument();
    expect(screen.queryByText('Create Jira')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Link existing Jira issue')).not.toBeInTheDocument();
  });

  it('replaces Create Jira with the authoritative linked issue immediately after create succeeds', async () => {
    vi.mocked(createJiraIssueFromActionItem).mockResolvedValueOnce({
      success: true,
      key: 'OPS-456',
      url: linkedIssue.url,
      externalIssue: linkedIssue,
    });

    render(
      <ActionItemJiraBadge
        actionItemId="ai-postmortem-1-existing"
        canManage
        jiraCapability={jiraCapability}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Create Jira/i }));

    await waitFor(() => expect(screen.getByText('OPS-456')).toBeInTheDocument());
    expect(screen.queryByText('Create Jira')).not.toBeInTheDocument();
  });
});
