import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActionItemJiraContext from '@/components/action-items/ActionItemJiraContext';
import { deriveJiraCapability, type JiraCapability } from '@/lib/jira-capabilities';
import type { ActionItemExternalIssue } from '@/lib/action-items';

vi.mock('@/app/(app)/action-items/jira/actions', () => ({
  createJiraIssueFromActionItem: vi.fn().mockResolvedValue({ success: true }),
  linkJiraIssueToActionItem: vi.fn().mockResolvedValue({ success: true }),
  unlinkJiraIssueFromActionItem: vi.fn().mockResolvedValue({ success: true }),
  syncActionItemJiraIssue: vi.fn().mockResolvedValue({ success: true }),
}));

const capability = (
  overrides: Partial<Parameters<typeof deriveJiraCapability>[0]> = {}
): JiraCapability =>
  deriveJiraCapability({
    workspaceState: 'ENABLED',
    canManage: true,
    serviceMapped: true,
    syncEnabled: true,
    rawEnabled: true,
    ...overrides,
  });

const historicalIssue: ActionItemExternalIssue = {
  linkId: 'jira-link-1',
  provider: 'JIRA',
  key: 'OPS-456',
  url: 'https://example.atlassian.net/browse/OPS-456',
  status: 'In Progress',
  assignee: 'Responder',
  syncState: 'SYNCED',
};

describe('ActionItemJiraContext visibility contract', () => {
  it('hides the complete Jira surface when the workspace is disabled and no link exists', () => {
    const { container } = render(
      <ActionItemJiraContext
        actionItemId="action-1"
        canManage
        jiraCapability={capability({ workspaceState: 'DISABLED', rawEnabled: false })}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Action Item Jira')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Jira')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Link existing Jira issue')).not.toBeInTheDocument();
  });

  it('hides the complete Jira surface when Jira is not configured and no link exists', () => {
    const { container } = render(
      <ActionItemJiraContext
        actionItemId="action-1"
        canManage
        jiraCapability={capability({
          workspaceState: 'NOT_CONFIGURED',
          serviceMapped: false,
          rawEnabled: false,
        })}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Action Item Jira')).not.toBeInTheDocument();
  });

  it('preserves a historical action-item Jira link read-only while Jira is disabled', () => {
    render(
      <ActionItemJiraContext
        actionItemId="action-1"
        externalIssue={historicalIssue}
        canManage
        jiraCapability={capability({ workspaceState: 'DISABLED', rawEnabled: false })}
      />
    );

    expect(screen.getByText('Action Item Jira')).toBeInTheDocument();
    const link = screen.getByText('OPS-456').closest('a');
    expect(link).toBeInTheDocument();

    fireEvent.mouseEnter(link!.parentElement!);
    expect(screen.queryByTitle('Sync status')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Unlink')).not.toBeInTheDocument();
  });

  it('shows only useful Jira actions for an enabled but unmapped service', () => {
    render(
      <ActionItemJiraContext
        actionItemId="action-1"
        canManage
        jiraCapability={capability({ serviceMapped: false, syncEnabled: true })}
      />
    );

    expect(screen.getByText('Action Item Jira')).toBeInTheDocument();
    expect(screen.queryByText('Create Jira')).not.toBeInTheDocument();
    expect(screen.getByTitle('Link existing Jira issue')).toBeInTheDocument();
  });

  it('shows create and link actions when Jira and the service mapping are operational', () => {
    render(
      <ActionItemJiraContext
        actionItemId="action-1"
        canManage
        jiraCapability={capability()}
      />
    );

    expect(screen.getByText('Action Item Jira')).toBeInTheDocument();
    expect(screen.getByText('Create Jira')).toBeInTheDocument();
    expect(screen.getByTitle('Link existing Jira issue')).toBeInTheDocument();
  });
});
