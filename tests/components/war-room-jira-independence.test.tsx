import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IncidentCommandBar from '@/components/incident/detail/IncidentCommandBar';
import { deriveJiraCapability } from '@/lib/jira-capabilities';

vi.mock('@/components/incident/ResolveIncidentModal', () => ({ default: () => null }));
vi.mock('@/components/incident/detail/SnoozeDurationDialog', () => ({ default: () => null }));
vi.mock('@/components/incident/detail/IncidentTags', () => ({ default: () => null }));
vi.mock('@/app/(app)/incidents/snooze-actions', () => ({ snoozeIncidentWithDuration: vi.fn() }));
vi.mock('@/app/(app)/incidents/jira/actions', () => ({
  createJiraIssueFromIncident: vi.fn().mockResolvedValue({ success: true }),
  linkJiraIssueToIncident: vi.fn().mockResolvedValue({ success: true }),
  unlinkJiraIssueFromIncident: vi.fn().mockResolvedValue({ success: true }),
  syncIncidentJiraIssue: vi.fn().mockResolvedValue({ success: true }),
}));

const disabledJira = deriveJiraCapability({
  workspaceState: 'DISABLED',
  canManage: true,
  serviceMapped: true,
  syncEnabled: true,
  rawEnabled: false,
});

describe('IncidentCommandBar integration independence', () => {
  it('keeps Create War-Room available when Jira is disabled', () => {
    render(
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
        collaboration={{
          visible: true,
          incidentId: 'incident-1',
          incidentStatus: 'OPEN',
          providers: [
            {
              provider: 'SLACK',
              displayName: 'Slack',
              subtitle: 'Incident channel in Slack',
              availability: 'AVAILABLE',
              visible: true,
              canCreate: true,
              unavailableReason: null,
              currentRoom: null,
              historyCount: 0,
              history: [],
              supportedOptions: { supportsPrivateRooms: true },
            },
          ],
          history: [],
          summary: {
            activeRooms: 0,
            transitioningRooms: 0,
            attentionRequired: 0,
            totalHistoricalRooms: 0,
          },
          permissions: {
            canManageWarRooms: true,
          },
        }}
        jira={{
          links: [],
          enabled: false,
          serviceMapped: true,
          serviceSettingsHref: '/services/service-1?tab=settings',
        }}
        tags={[]}
        jiraCapability={disabledJira}
      />
    );

    expect(screen.getAllByText('Create war room').length).toBeGreaterThan(0);
    expect(screen.queryByText('Link Jira Issue')).not.toBeInTheDocument();
  });
});
