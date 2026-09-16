import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IncidentMeetingCard } from '@/components/incident/war-room/IncidentMeetingCard';
import type { IncidentMeetingView } from '@/lib/incident-collaboration/types';

describe('IncidentMeetingCard Component', () => {
  const readyMeeting: IncidentMeetingView = {
    id: 'meet-1',
    incidentId: 'inc-123',
    generation: 1,
    provider: 'MICROSOFT_TEAMS',
    state: 'READY',
    health: 'HEALTHY',
    externalId: 'opsknight:inc-123:1',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/12345',
    conferenceId: '987654',
    tollNumber: '+1 555-0199',
    createdAt: new Date().toISOString(),
    actions: {
      canJoin: true,
      canProvision: false,
      canRetry: false,
      canClose: true,
    },
  };

  it('renders ready Teams meeting with join link, dial-in info, and copy action', () => {
    render(<IncidentMeetingCard meeting={readyMeeting} />);

    expect(screen.getByText('Microsoft Teams Meeting')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Dial: +1 555-0199')).toBeInTheDocument();
    expect(screen.getByText('Conf ID: 987654')).toBeInTheDocument();

    const joinLink = screen.getByRole('link', { name: /Join Meeting/i });
    expect(joinLink).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/12345');
    expect(screen.getByRole('button', { name: /Copy Link/i })).toBeInTheDocument();
  });

  it('renders requested state with start meeting bridge button and invokes onAction', async () => {
    const onAction = vi.fn();
    const requestedMeeting: IncidentMeetingView = {
      ...readyMeeting,
      state: 'REQUESTED',
      health: 'HEALTHY',
      joinUrl: '',
      actions: {
        canJoin: false,
        canProvision: true,
        canRetry: false,
        canClose: false,
      },
    };

    render(<IncidentMeetingCard meeting={requestedMeeting} onAction={onAction} />);

    expect(screen.getByText('Not started')).toBeInTheDocument();
    const startBtn = screen.getByRole('button', { name: /Start Meeting Bridge/i });
    expect(startBtn).toBeInTheDocument();

    await React.act(async () => {
      fireEvent.click(startBtn);
    });
    expect(onAction).toHaveBeenCalledWith('PROVISION');
  });

  it('renders failed meeting with error message and retry button', async () => {
    const onAction = vi.fn();
    const failedMeeting: IncidentMeetingView = {
      ...readyMeeting,
      state: 'FAILED',
      health: 'UNAVAILABLE',
      joinUrl: '',
      lastErrorCode: 'TEAMS_CONFIG_MISSING',
      lastErrorMessage: 'Microsoft Entra permissions missing.',
      actions: {
        canJoin: false,
        canProvision: false,
        canRetry: true,
        canClose: false,
      },
    };

    render(<IncidentMeetingCard meeting={failedMeeting} onAction={onAction} />);

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/Microsoft Entra permissions missing/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Retry Meeting/i });
    expect(retryBtn).toBeInTheDocument();

    await React.act(async () => {
      fireEvent.click(retryBtn);
    });
    expect(onAction).toHaveBeenCalledWith('RETRY');
  });

  it('renders provisioning state with generating badge', () => {
    const provisioningMeeting: IncidentMeetingView = {
      ...readyMeeting,
      state: 'PROVISIONING',
      joinUrl: '',
      actions: {
        canJoin: false,
        canProvision: false,
        canRetry: false,
        canClose: false,
      },
    };

    render(<IncidentMeetingCard meeting={provisioningMeeting} />);
    expect(screen.getByText('Generating')).toBeInTheDocument();
  });

  it('invokes onAction on close button click', async () => {
    const onAction = vi.fn();
    render(<IncidentMeetingCard meeting={readyMeeting} onAction={onAction} />);

    const closeBtn = screen.getByTitle('Close meeting');
    await React.act(async () => {
      fireEvent.click(closeBtn);
    });
    expect(onAction).toHaveBeenCalledWith('CLOSE');
  });

  it('renders custom closeLabel and supports external close semantics', async () => {
    const customMeeting: IncidentMeetingView = {
      ...readyMeeting,
      actions: {
        ...readyMeeting.actions,
        closeLabel: 'End Meeting',
        supportsExternalClose: true,
      },
    };
    render(<IncidentMeetingCard meeting={customMeeting} />);
    expect(screen.getByTitle('End Meeting')).toBeInTheDocument();
  });
});
