import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WarRoomLauncher } from '@/components/incident/war-room/WarRoomLauncher';
import type { IncidentCollaborationView } from '@/lib/incident-collaboration/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe('WarRoomLauncher component', () => {
  it('renders nothing if collaboration is not visible', () => {
    const hiddenCollab: IncidentCollaborationView = {
      visible: false,
      incidentId: 'inc-1',
      incidentStatus: 'OPEN',
      summary: {
        activeRooms: 0,
        transitioningRooms: 0,
        attentionRequired: 0,
        totalHistoricalRooms: 0,
      },
      providers: [],
      history: [],
      permissions: { canManageWarRooms: true },
    };

    const { container } = render(<WarRoomLauncher collaboration={hiddenCollab} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Create war room" when canCreate is true and no active rooms exist', () => {
    const createCollab: IncidentCollaborationView = {
      visible: true,
      incidentId: 'inc-2',
      incidentStatus: 'OPEN',
      summary: {
        activeRooms: 0,
        transitioningRooms: 0,
        attentionRequired: 0,
        totalHistoricalRooms: 0,
      },
      providers: [
        {
          provider: 'SLACK',
          displayName: 'Slack',
          subtitle: 'Incident channel in Slack',
          availability: 'AVAILABLE',
          visible: true,
          enabledForService: true,
          destinationAvailable: true,
          canCreate: true,
          unavailableReason: null,
          currentRoom: null,
          historyCount: 0,
          history: [],
          supportedOptions: { supportsPrivateRooms: false },
        },
      ],
      history: [],
      permissions: { canManageWarRooms: true },
    };

    render(<WarRoomLauncher collaboration={createCollab} />);
    expect(screen.getByText('Create war room')).toBeInTheDocument();
  });

  it('renders single active room label and opens manager on click', () => {
    const activeCollab: IncidentCollaborationView = {
      visible: true,
      incidentId: 'inc-3',
      incidentStatus: 'OPEN',
      summary: {
        activeRooms: 1,
        transitioningRooms: 0,
        attentionRequired: 0,
        totalHistoricalRooms: 0,
      },
      providers: [
        {
          provider: 'SLACK',
          displayName: 'Slack',
          subtitle: 'Incident channel in Slack',
          availability: 'AVAILABLE',
          visible: true,
          enabledForService: true,
          destinationAvailable: true,
          canCreate: false,
          unavailableReason: null,
          currentRoom: {
            id: 'room-1',
            provider: 'SLACK',
            generation: 1,
            state: 'READY',
            health: 'HEALTHY',
            channelId: 'C123',
            channelName: 'inc-3-warroom',
            channelUrl: 'https://slack.com/archives/C123',
            deepLinkUrl: 'slack://channel?id=C123',
            membershipType: null,
            createdAt: new Date().toISOString(),
            readyAt: new Date().toISOString(),
            closedAt: null,
            archivedAt: null,
            lastError: null,
            lastErrorCode: null,
            lastReconciledAt: null,
            actions: {
              canOpen: true,
              canCreate: false,
              canClose: true,
              canReconcile: false,
              canSyncParticipants: true,
              canRefreshProjection: false,
              canRetryCleanup: false,
              canCreateReplacementProjection: false,
            },
            participants: {
              synced: 2,
              pending: 0,
              attentionRequired: 0,
              total: 2,
              items: [],
            },
          },
          historyCount: 0,
          history: [],
          supportedOptions: { supportsPrivateRooms: false },
        },
      ],
      history: [],
      permissions: { canManageWarRooms: true },
    };

    render(<WarRoomLauncher collaboration={activeCollab} />);
    const button = screen.getByRole('button', { name: /Open incident collaboration manager/i });
    expect(button).toBeInTheDocument();
    expect(screen.getByText('War room')).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByText('Incident Collaboration')).toBeInTheDocument();
    expect(screen.getByText(/Active War Rooms/i)).toBeInTheDocument();
  });
});
