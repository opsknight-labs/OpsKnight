import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ServiceResponsePolicyHub from '@/components/service/ServiceResponsePolicyHub';

vi.mock('@/app/(app)/settings/incident-sla/actions', () => ({
  saveIncidentSlaPolicyAction: vi.fn(),
  saveScopedClassificationPolicyAction: vi.fn(),
  saveWorkspaceClassificationPolicyAction: vi.fn(),
  saveSupportHoursPolicyAction: vi.fn(),
}));

describe('ServiceResponsePolicyHub', () => {
  const mockSlaPolicy = {
    version: 1,
    inheritWorkspace: true,
    baseAckTargetMs: null,
    baseResolveTargetMs: null,
    rules: [],
  };

  const mockWorkspaceSla = {
    version: 3,
    inheritWorkspace: false,
    baseAckTargetMs: 15 * 60000,
    baseResolveTargetMs: 120 * 60000,
    rules: [],
  };

  const mockClassification = {
    version: 1,
    derivePriorityFromUrgency: false,
    priorityFallbackMode: 'INHERIT' as const,
    rules: [
      { matchValue: 'critical' as const, priority: null, urgency: 'HIGH' as const },
      { matchValue: 'error' as const, priority: null, urgency: 'MEDIUM' as const },
      { matchValue: 'warning' as const, priority: null, urgency: 'MEDIUM' as const },
      { matchValue: 'info' as const, priority: null, urgency: 'LOW' as const },
    ],
  };

  const mockSupportHours = {
    version: 1,
    timezone: 'UTC',
    mode: 'ALWAYS' as const,
    windows: [],
    exceptions: [],
  };

  it('renders card header, status badges, and tab switcher', () => {
    render(
      <ServiceResponsePolicyHub
        serviceId="svc-123"
        incidentSlaPolicy={mockSlaPolicy}
        workspaceIncidentSlaPolicy={mockWorkspaceSla}
        incidentClassificationPolicy={mockClassification}
        responseSupportHoursPolicy={mockSupportHours}
        canManage={true}
      />
    );

    expect(screen.getByText('Response Policies & SLAs')).toBeInTheDocument();
    expect(screen.getByText('Workspace SLA')).toBeInTheDocument();
    expect(screen.getByText('24×7 Coverage')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /sla targets & deadlines/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /alert classification/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /support hours & coverage/i })).toBeInTheDocument();
  });

  it('renders SLA targets by default and allows switching to Alert Classification and Support Hours', () => {
    render(
      <ServiceResponsePolicyHub
        serviceId="svc-123"
        incidentSlaPolicy={mockSlaPolicy}
        workspaceIncidentSlaPolicy={mockWorkspaceSla}
        incidentClassificationPolicy={mockClassification}
        responseSupportHoursPolicy={mockSupportHours}
        canManage={true}
      />
    );

    // Default tab shows SLA targets
    expect(screen.getByText(/inherit workspace defaults/i)).toBeInTheDocument();
    expect(screen.getByText(/priority-specific overrides/i)).toBeInTheDocument();

    // Switch to Alert Classification
    const classTab = screen.getByRole('button', { name: /alert classification/i });
    fireEvent.click(classTab);

    expect(screen.getByText(/inbound alert severity/i)).toBeInTheDocument();
    expect(screen.getByText(/urgency fallback behavior/i)).toBeInTheDocument();

    // Switch to Support Hours
    const hoursTab = screen.getByRole('button', { name: /support hours & coverage/i });
    fireEvent.click(hoursTab);

    expect(screen.getByText(/operational coverage mode/i)).toBeInTheDocument();
    expect(screen.getByText(/24×7 continuous/i)).toBeInTheDocument();
  });
});
