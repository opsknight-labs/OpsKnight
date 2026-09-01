import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SLABreachWarningBadge from '@/components/incident/SLABreachWarningBadge';
import { Incident, Service } from '@prisma/client';

// Mock sla-priority to return predictable targets
vi.mock('@/lib/sla-priority', () => ({
  getPrioritySLATarget: () => ({ ack: 15, resolve: 120 }),
}));

describe('SLABreachWarningBadge', () => {
  const mockService = {
    id: 'svc-1',
    name: 'Test Service',
    slug: 'test-service',
    description: null,
    targetAckMinutes: 15,
    targetResolveMinutes: 120,
    slackWebhookUrl: null,
    isPrivate: false,
    updatedAt: new Date(),
    createdAt: new Date(),
    region: null,
    slaTier: null,
    status: 'ACTIVE',
    teamId: null,
    escalationPolicyId: null,
    maintenanceMode: false,
    maintenanceMessage: null,
    maintenanceEndsAt: null,
    slackChannelId: null,
    onCallEnabled: true,
    notifyOnAck: false,
    notifyOnResolve: false,
    notifyEventFilter: null,
    autoCreateWarRoom: true,
    warRoomVideoBridge: null,
    warRoomCustomBridgeUrl: null,
  } as unknown as Service;

  const mockIncidentBase = {
    id: 'inc-1',
    title: 'Test Incident',
    description: null,
    status: 'OPEN',
    priority: 'P2',
    urgency: 'HIGH',
    serviceId: 'svc-1',
    teamId: null,
    assigneeId: null,
    resolvedAt: null,
    updatedAt: new Date(),
    nextEscalationAt: null,
    escalationStatus: 'IDLE',
    currentEscalationStep: 0,
    isMuted: false,
    impact: 'NONE',
    tags: [],
    snoozedUntil: null,
    snoozeReason: null,
    autoResolvedAt: null,
    notificationProcessingAt: null,
    externalId: null,
    region: null,
    dedupKey: null,
    escalationProcessingAt: null,
    visibility: 'PUBLIC',
    slackChannelId: null,
    slackChannelName: null,
    warRoomUrl: null,
    warRoomArchivedAt: null,
  };

  it('renders correctly with Date objects', () => {
    // 5 hours old -> Breached ACK (15m)
    const incident = {
      ...mockIncidentBase,
      createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      acknowledgedAt: null,
    } as Incident;

    render(<SLABreachWarningBadge incident={incident} service={mockService} />);

    expect(screen.getByText('ACK breached')).toBeDefined();
  });

  it('handles string date props (client-side serialization simulation)', () => {
    // 5 hours old, passed as ISO STRING
    const createdAtStr = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

    const incident = {
      ...mockIncidentBase,
      createdAt: createdAtStr as unknown as Date,
      acknowledgedAt: null,
    } as Incident;

    // This would crash without the fix
    render(<SLABreachWarningBadge incident={incident} service={mockService} />);

    expect(screen.getByText('ACK breached')).toBeDefined();
  });

  it('renders warning when approaching breach', () => {
    // 12 mins old (Target 15m) -> 3 mins remaining -> Warning
    // Warning threshold default is 5m
    const incident = {
      ...mockIncidentBase,
      createdAt: new Date(Date.now() - 12 * 60 * 1000),
      acknowledgedAt: null,
    } as Incident;

    render(<SLABreachWarningBadge incident={incident} service={mockService} />);

    expect(screen.getByText('3m to ACK')).toBeDefined();
  });
});
