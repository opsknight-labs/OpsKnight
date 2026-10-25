import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { IncidentInspector } from '@/components/dashboard/live/IncidentInspector';
import type { LiveIncident } from '@/lib/dashboard/live-incidents-shared';

const mockIncident: LiveIncident = {
  id: 'inc-inspect-1',
  title: 'Payment Gateway Connection Timeout',
  status: 'OPEN',
  urgency: 'HIGH',
  priority: 'P1',
  createdAt: new Date(Date.now() - 120_000).toISOString(),
  updatedAt: new Date().toISOString(),
  acknowledgedAt: null,
  slaFirstAcknowledgedAt: null,
  slaAckTargetMs: null,
  slaResolveTargetMs: null,
  slaTargetSource: null,
  slaTargetCapturedAt: null,
  slaPausedMs: 0,
  slaPauseStartedAt: null,
  slaAckElapsedMs: null,
  slaResolveElapsedMs: null,
  service: { id: 'srv-1', name: 'Payment API', teamId: 'team-1' },
  team: { id: 'team-1', name: 'Checkout Team' },
  assignee: null,
  escalationLevel: 1,
  escalationStatus: 'active',
  alertCount: 4,
  responderCount: 2,
  sla: {
    phase: 'ack',
    deadline: new Date(Date.now() + 600_000).toISOString(),
    warning: 'NONE',
  },
};

describe('IncidentInspector', () => {
  it('renders incident core details, service context, and honest unconfigured states without fabricated claims', () => {
    render(
      <IncidentInspector
        incident={mockIncident}
        now={Date.now()}
        currentUserId="usr-1"
        canAcknowledge={true}
        canAssignSelf={true}
        busy={null}
        onAcknowledge={vi.fn()}
        onAssignSelf={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('incident-inspector')).toBeDefined();
    expect(screen.getByText('Payment Gateway Connection Timeout')).toBeDefined();
    expect(screen.getByText('Payment API')).toBeDefined();
    expect(screen.getByText('Checkout Team')).toBeDefined();
    expect(screen.getByText('Unassigned')).toBeDefined();
    expect(screen.getByText(/4 signals/)).toBeDefined();
    expect(screen.getByText('Step 1')).toBeDefined();
    expect(screen.getByText('No runbook executions')).toBeDefined();
    expect(screen.getAllByText('Not configured').length).toBeGreaterThan(0);
  });

  it('renders verified automation, runbook execution outcome, and deduplication telemetry when configured', () => {
    const verifiedIncident: LiveIncident = {
      ...mockIncident,
      dedupKey: 'srv-1:payment-timeout',
      routeRuleName: 'Payment Gateway Auto-Route',
      escalationPolicyName: 'Tier 1 SRE Escalation',
      latestRunbook: {
        name: 'Restart Gateway Pods',
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        failureCode: null,
      },
    };

    render(
      <IncidentInspector
        incident={verifiedIncident}
        now={Date.now()}
        currentUserId="usr-1"
        canAcknowledge={true}
        canAssignSelf={true}
        busy={null}
        onAcknowledge={vi.fn()}
        onAssignSelf={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Payment Gateway Auto-Route')).toBeDefined();
    expect(screen.getByText('Step 1 · Tier 1 SRE Escalation')).toBeDefined();
    expect(screen.getByText(/Restart Gateway Pods: Completed/)).toBeDefined();
    expect(screen.getByText('srv-1:payment-timeout')).toBeDefined();
  });

  it('triggers onAcknowledge when acknowledge button is clicked', () => {
    const handleAck = vi.fn();
    render(
      <IncidentInspector
        incident={mockIncident}
        now={Date.now()}
        currentUserId="usr-1"
        canAcknowledge={true}
        canAssignSelf={true}
        busy={null}
        onAcknowledge={handleAck}
        onAssignSelf={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const ackButton = screen.getByTestId('inspector-ack');
    fireEvent.click(ackButton);
    expect(handleAck).toHaveBeenCalledWith(mockIncident);
  });

  it('triggers onAssignSelf when assign button is clicked', () => {
    const handleAssign = vi.fn();
    render(
      <IncidentInspector
        incident={mockIncident}
        now={Date.now()}
        currentUserId="usr-1"
        canAcknowledge={true}
        canAssignSelf={true}
        busy={null}
        onAcknowledge={vi.fn()}
        onAssignSelf={handleAssign}
        onClose={vi.fn()}
      />
    );

    const assignButton = screen.getByTestId('inspector-assign-me');
    fireEvent.click(assignButton);
    expect(handleAssign).toHaveBeenCalledWith(mockIncident);
  });

  it('calls onClose when close button is clicked or Escape key is pressed', () => {
    const handleClose = vi.fn();
    render(
      <IncidentInspector
        incident={mockIncident}
        now={Date.now()}
        currentUserId="usr-1"
        canAcknowledge={true}
        canAssignSelf={true}
        busy={null}
        onAcknowledge={vi.fn()}
        onAssignSelf={vi.fn()}
        onClose={handleClose}
      />
    );

    fireEvent.click(screen.getByTestId('inspector-close'));
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});
