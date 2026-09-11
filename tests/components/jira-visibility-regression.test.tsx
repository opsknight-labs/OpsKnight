import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IncidentCommandBar, {
  type JiraLinkItem,
} from '@/components/incident/detail/IncidentCommandBar';
import ActionItemJiraBadge from '@/components/action-items/ActionItemJiraBadge';
import PostmortemActionItems from '@/components/postmortem/PostmortemActionItems';
import { deriveJiraCapability, type JiraCapability } from '@/lib/jira-capabilities';
import type { ActionItem, ActionItemExternalIssue } from '@/lib/action-items';

vi.mock('@/components/incident/ResolveIncidentModal', () => ({
  default: () => null,
}));

vi.mock('@/components/incident/detail/SnoozeDurationDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/incident/detail/IncidentTags', () => ({
  default: () => null,
}));

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

vi.mock('@/app/(app)/incidents/snooze-actions', () => ({
  snoozeIncidentWithDuration: vi.fn(),
}));

vi.mock('@/app/(app)/incidents/jira/actions', () => ({
  createJiraIssueFromIncident: vi.fn().mockResolvedValue({ success: true }),
  linkJiraIssueToIncident: vi.fn().mockResolvedValue({ success: true }),
  unlinkJiraIssueFromIncident: vi.fn().mockResolvedValue({ success: true }),
  syncIncidentJiraIssue: vi.fn().mockResolvedValue({ success: true }),
}));

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

const incidentLink: JiraLinkItem = {
  id: 'jira-link-1',
  externalKey: 'OPS-123',
  externalUrl: 'https://example.atlassian.net/browse/OPS-123',
  externalStatus: 'In Progress',
  externalAssignee: 'Responder',
  syncState: 'SYNCED',
  lastSyncedAt: null,
};

const actionItemLink: ActionItemExternalIssue = {
  linkId: 'action-jira-link-1',
  provider: 'JIRA',
  key: 'OPS-456',
  url: 'https://example.atlassian.net/browse/OPS-456',
  status: 'In Progress',
  assignee: 'Responder',
  syncState: 'SYNCED',
};

function renderIncident(jiraCapability: JiraCapability, links: JiraLinkItem[] = []) {
  return render(
    <IncidentCommandBar
      incidentId="incident-1"
      currentStatus="OPEN"
      canManage
      canAcknowledge={false}
      snoozedUntil={null}
      onAcknowledge={vi.fn()}
      onUnacknowledge={vi.fn()}
      onUnsnooze={vi.fn()}
      onSuppress={vi.fn()}
      onUnsuppress={vi.fn()}
      resolvingIncident={{} as never}
      postmortemHref="/postmortems/incident-1"
      postmortemExists={false}
      warRoom={null}
      jira={{
        links,
        enabled: jiraCapability.rawEnabled,
        serviceMapped: jiraCapability.serviceMapped,
        serviceSettingsHref: '/services/service-1?tab=settings',
      }}
      tags={[]}
      jiraCapability={jiraCapability}
    />
  );
}

function openMobileActions() {
  const triggers = screen.getAllByLabelText('More incident actions');
  fireEvent.click(triggers[triggers.length - 1]);
}

function PostmortemActionItemsHarness({
  initialItems = [],
}: {
  initialItems?: ActionItem[];
}) {
  const [items, setItems] = useState<ActionItem[]>(initialItems);
  return (
    <PostmortemActionItems
      actionItems={items}
      onChange={setItems}
      users={[]}
      jiraCapability={capability()}
    />
  );
}

describe('IncidentCommandBar Jira visibility regression contract', () => {
  it('NOT_CONFIGURED hides Jira on desktop and mobile and never offers Connect Jira', () => {
    renderIncident(
      capability({
        workspaceState: 'NOT_CONFIGURED',
        serviceMapped: false,
        syncEnabled: true,
        rawEnabled: false,
      })
    );

    expect(screen.queryByText('Connect Jira')).not.toBeInTheDocument();
    expect(screen.queryByText('Link Jira Issue')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Jira Issue')).not.toBeInTheDocument();

    openMobileActions();
    expect(screen.queryByText('Connect Jira')).not.toBeInTheDocument();
    expect(screen.queryByText('Link Jira Issue')).not.toBeInTheDocument();
    expect(screen.queryByText('Manage Jira Issues')).not.toBeInTheDocument();
  });

  it('DISABLED keeps a historical incident Jira link read-only on desktop and mobile', () => {
    renderIncident(
      capability({
        workspaceState: 'DISABLED',
        serviceMapped: true,
        syncEnabled: true,
        rawEnabled: false,
      }),
      [incidentLink]
    );

    expect(screen.getByText('OPS-123')).toBeInTheDocument();
    expect(screen.queryByText('Sync')).not.toBeInTheDocument();
    expect(screen.queryByText('Manage')).not.toBeInTheDocument();

    openMobileActions();
    expect(screen.queryByText('Manage Jira Issues')).not.toBeInTheDocument();
  });

  it('ENABLED + unmapped allows Link and linked-issue Sync but not Create', () => {
    const unmapped = capability({ serviceMapped: false, syncEnabled: true });
    const { unmount } = renderIncident(unmapped);

    const linkButtons = screen.getAllByText('Link Jira Issue');
    expect(linkButtons.length).toBeGreaterThan(0);
    fireEvent.click(linkButtons[0]);
    expect(screen.queryByText('Create Jira Issue')).not.toBeInTheDocument();
    expect(screen.getByText('Configure Service Mapping')).toBeInTheDocument();

    // Treat the no-link and historical-link states as independent user scenarios.
    // Re-rendering the same tree would intentionally preserve the open Radix dialog
    // portal and make the issue key appear in both the dialog and command bar.
    unmount();
    renderIncident(unmapped, [incidentLink]);

    expect(screen.getByText('OPS-123')).toBeInTheDocument();
    expect(screen.getByText('Sync')).toBeInTheDocument();
  });

  it('ENABLED + mapped + syncEnabled=false shows Create/Link but no Sync', () => {
    const noSync = capability({ serviceMapped: true, syncEnabled: false });
    const { unmount } = renderIncident(noSync);

    fireEvent.click(screen.getAllByText('Link Jira Issue')[0]);
    expect(screen.getByText('Create Jira Issue')).toBeInTheDocument();
    expect(screen.getByText('Or link an existing issue key')).toBeInTheDocument();
    unmount();

    renderIncident(noSync, [incidentLink]);
    expect(screen.getByText('OPS-123')).toBeInTheDocument();
    expect(screen.queryByText('Sync')).not.toBeInTheDocument();
    expect(screen.getByText('Manage')).toBeInTheDocument();
  });

  it('ENABLED + mapped + syncEnabled=true exposes full linked-issue controls', () => {
    renderIncident(capability(), [incidentLink]);

    expect(screen.getByText('OPS-123')).toBeInTheDocument();
    expect(screen.getByText('Sync')).toBeInTheDocument();
    expect(screen.getByText('Manage')).toBeInTheDocument();
  });
});

describe('ActionItemJiraBadge Jira visibility regression contract', () => {
  it('NOT_CONFIGURED renders no Jira affordance when no historical link exists', () => {
    const { container } = render(
      <ActionItemJiraBadge
        actionItemId="action-1"
        canManage
        jiraCapability={capability({
          workspaceState: 'NOT_CONFIGURED',
          serviceMapped: false,
          syncEnabled: true,
          rawEnabled: false,
        })}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Create Jira')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Link existing Jira issue')).not.toBeInTheDocument();
  });

  it('DISABLED keeps a historical action-item Jira link read-only', () => {
    render(
      <ActionItemJiraBadge
        actionItemId="action-1"
        externalIssue={actionItemLink}
        canManage
        jiraCapability={capability({ workspaceState: 'DISABLED', rawEnabled: false })}
      />
    );

    const link = screen.getByText('OPS-456').closest('a');
    expect(link).toBeInTheDocument();
    fireEvent.mouseEnter(link!.parentElement!);
    expect(screen.queryByTitle('Sync status')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Unlink')).not.toBeInTheDocument();
  });

  it('ENABLED + unmapped allows Link and linked-issue Sync but not Create', () => {
    const unmapped = capability({ serviceMapped: false, syncEnabled: true });
    const { unmount } = render(
      <ActionItemJiraBadge actionItemId="action-1" canManage jiraCapability={unmapped} />
    );

    expect(screen.queryByText('Create Jira')).not.toBeInTheDocument();
    expect(screen.getByTitle('Link existing Jira issue')).toBeInTheDocument();
    unmount();

    render(
      <ActionItemJiraBadge
        actionItemId="action-1"
        externalIssue={actionItemLink}
        canManage
        jiraCapability={unmapped}
      />
    );
    const linked = screen.getByText('OPS-456').closest('a')!;
    fireEvent.mouseEnter(linked.parentElement!);
    expect(screen.getByTitle('Sync status')).toBeInTheDocument();
    expect(screen.getByTitle('Unlink')).toBeInTheDocument();
  });

  it('ENABLED + mapped + syncEnabled=false keeps Create/Link and removes Sync', () => {
    const noSync = capability({ syncEnabled: false });
    const { unmount } = render(
      <ActionItemJiraBadge actionItemId="action-1" canManage jiraCapability={noSync} />
    );

    expect(screen.getByText('Create Jira')).toBeInTheDocument();
    expect(screen.getByTitle('Link existing Jira issue')).toBeInTheDocument();
    unmount();

    render(
      <ActionItemJiraBadge
        actionItemId="action-1"
        externalIssue={actionItemLink}
        canManage
        jiraCapability={noSync}
      />
    );
    const linked = screen.getByText('OPS-456').closest('a')!;
    fireEvent.mouseEnter(linked.parentElement!);
    expect(screen.queryByTitle('Sync status')).not.toBeInTheDocument();
    expect(screen.getByTitle('Unlink')).toBeInTheDocument();
  });

  it('ENABLED + mapped + syncEnabled=true exposes full Jira controls', () => {
    const full = capability();
    const { unmount } = render(
      <ActionItemJiraBadge actionItemId="action-1" canManage jiraCapability={full} />
    );

    expect(screen.getByText('Create Jira')).toBeInTheDocument();
    expect(screen.getByTitle('Link existing Jira issue')).toBeInTheDocument();
    unmount();

    render(
      <ActionItemJiraBadge
        actionItemId="action-1"
        externalIssue={actionItemLink}
        canManage
        jiraCapability={full}
      />
    );
    const linked = screen.getByText('OPS-456').closest('a')!;
    fireEvent.mouseEnter(linked.parentElement!);
    expect(screen.getByTitle('Sync status')).toBeInTheDocument();
    expect(screen.getByTitle('Unlink')).toBeInTheDocument();
  });
});

describe('PostmortemActionItems persisted Jira controls', () => {
  it('does not expose Jira actions for a newly added unsaved action item', () => {
    render(<PostmortemActionItemsHarness />);

    fireEvent.change(screen.getByPlaceholderText('e.g., Add monitoring for service X'), {
      target: { value: 'Draft follow-up' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Action Item' }));

    expect(screen.getByText('Draft follow-up')).toBeInTheDocument();
    expect(screen.queryByText('Create Jira')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Link existing Jira issue')).not.toBeInTheDocument();
  });

  it('keeps Jira actions available for an already persisted action item', () => {
    render(
      <PostmortemActionItemsHarness
        initialItems={[
          {
            id: 'ai_postmortem-1_existing',
            title: 'Persisted follow-up',
            description: '',
            status: 'OPEN',
            priority: 'MEDIUM',
          },
        ]}
      />
    );

    expect(screen.getByText('Persisted follow-up')).toBeInTheDocument();
    expect(screen.getByText('Create Jira')).toBeInTheDocument();
    expect(screen.getByTitle('Link existing Jira issue')).toBeInTheDocument();
  });
});
