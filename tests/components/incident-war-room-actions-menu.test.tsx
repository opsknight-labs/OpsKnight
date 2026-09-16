import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WarRoomActionsMenu } from '@/components/incident/war-room/WarRoomActionsMenu';
import type { IncidentWarRoomView } from '@/lib/incident-collaboration/types';

describe('WarRoomActionsMenu component', () => {
  it('renders trigger button and is accessible', () => {
    const onAction = vi.fn();

    const room: IncidentWarRoomView = {
      id: 'room-1',
      provider: 'SLACK',
      generation: 1,
      state: 'READY',
      health: 'HEALTHY',
      channelId: 'C123',
      channelName: 'incident-war-room',
      channelUrl: 'https://slack.com',
      deepLinkUrl: null,
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
        canReconcile: true,
        canSyncParticipants: true,
        canRefreshProjection: true,
        canRetryCleanup: false,
        canCreateReplacementProjection: false,
      },
      participants: { synced: 1, pending: 0, attentionRequired: 0, total: 1, items: [] },
    };

    render(<WarRoomActionsMenu room={room} onAction={onAction} />);

    const trigger = screen.getByRole('button', { name: /Actions for incident-war-room war room/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).not.toBeDisabled();
  });

  it('renders nothing when no actions are available', () => {
    const noActionRoom: IncidentWarRoomView = {
      id: 'room-2',
      provider: 'SLACK',
      generation: 1,
      state: 'CLOSED',
      health: 'HEALTHY',
      channelId: 'C123',
      channelName: 'incident-war-room',
      channelUrl: 'https://slack.com',
      deepLinkUrl: null,
      membershipType: null,
      createdAt: new Date().toISOString(),
      readyAt: null,
      closedAt: new Date().toISOString(),
      archivedAt: null,
      lastError: null,
      lastErrorCode: null,
      lastReconciledAt: null,
      actions: {
        canOpen: true,
        canCreate: false,
        canClose: false,
        canReconcile: false,
        canSyncParticipants: false,
        canRefreshProjection: false,
        canRetryCleanup: false,
        canCreateReplacementProjection: false,
      },
      participants: { synced: 0, pending: 0, attentionRequired: 0, total: 0, items: [] },
    };

    const { container } = render(<WarRoomActionsMenu room={noActionRoom} onAction={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });
});
