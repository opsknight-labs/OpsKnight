import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WarRoomLifecycleBadge } from '@/components/incident/war-room/WarRoomLifecycleBadge';
import { WarRoomHealthBadge } from '@/components/incident/war-room/WarRoomHealthBadge';
import { WarRoomParticipantSummary } from '@/components/incident/war-room/WarRoomParticipantSummary';

describe('WarRoom visual badge and summary components', () => {
  it('renders correct lifecycle labels and tones', () => {
    const { rerender } = render(<WarRoomLifecycleBadge state="READY" />);
    expect(screen.getByText('Active')).toBeInTheDocument();

    rerender(<WarRoomLifecycleBadge state="PROVISIONING" />);
    expect(screen.getByText('Creating…')).toBeInTheDocument();

    rerender(<WarRoomLifecycleBadge state="CLOSING" />);
    expect(screen.getByText('Closing…')).toBeInTheDocument();

    rerender(<WarRoomLifecycleBadge state="ARCHIVED" />);
    expect(screen.getByText('Archived')).toBeInTheDocument();

    rerender(<WarRoomLifecycleBadge state="FAILED" />);
    expect(screen.getByText('Creation failed')).toBeInTheDocument();
  });

  it('renders health badges when health is not healthy', () => {
    const { rerender } = render(<WarRoomHealthBadge health="HEALTHY" />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();

    rerender(<WarRoomHealthBadge health="DEGRADED" />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();

    rerender(<WarRoomHealthBadge health="MISSING" />);
    expect(screen.getByText('Room unavailable')).toBeInTheDocument();

    rerender(<WarRoomHealthBadge health="PERMISSION_ERROR" />);
    expect(screen.getByText('Permissions required')).toBeInTheDocument();
  });

  it('renders participant summary with synced and attention stats', () => {
    render(
      <WarRoomParticipantSummary
        participants={{
          synced: 3,
          pending: 1,
          attentionRequired: 1,
          total: 5,
          items: [
            {
              id: 'p-1',
              userId: 'u-1',
              name: 'Alice SRE',
              source: 'ON_CALL',
              state: 'PRESENT',
            },
            {
              id: 'p-2',
              userId: 'u-2',
              name: 'Bob Dev',
              source: 'ASSIGNEE',
              state: 'SKIPPED',
              lastError: 'User not found in workspace',
            },
          ],
        }}
      />
    );

    expect(screen.getByText(/3 synced · 1 pending · 1 needs attention/i)).toBeInTheDocument();
  });
});
