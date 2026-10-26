import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import { sendServiceNotifications } from '@/lib/service-notifications';
import { triggerStatusPageWebhooks } from '@/lib/status-page-webhooks';

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findUnique: vi.fn() },
    statusPageWebhook: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/notification-control-plane', () => ({ enqueueCentralNotification: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({
  generateIncidentWebhookPayload: vi.fn(() => ({ event: 'fixture' })),
}));
vi.mock('@/lib/encryption', () => ({
  decryptStoredSecret: vi.fn(async () => 'owned-fixture-secret'),
}));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://app.example.test' }));

function incident(status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED') {
  const at = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'incident',
    title: 'Owned fixture',
    description: null,
    status,
    urgency: 'HIGH',
    priority: 'P1',
    serviceId: 'service',
    escalationGeneration: 2,
    createdAt: at,
    updatedAt: at,
    acknowledgedAt: status === 'ACKNOWLEDGED' ? at : null,
    resolvedAt: status === 'RESOLVED' ? at : null,
    assignee: null,
    service: {
      id: 'service',
      name: 'Service',
      serviceNotificationChannels: [],
      webhookIntegrations: [],
      webhookUrl: 'https://receiver.example.test/webhook',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(enqueueCentralNotification).mockResolvedValue({ id: 'durable-intent', created: true });
});

describe('ordinary durable notification handoff', () => {
  it.each([
    ['acknowledged', 'ACKNOWLEDGED'],
    ['resolved', 'RESOLVED'],
  ] as const)(
    'hands %s service delivery to workers after preserving its lifecycle fence',
    async (event, status) => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(incident(status) as never);
      expect(await sendServiceNotifications('incident', event)).toEqual({ success: true });
      expect(enqueueCentralNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          trafficClass: 'TRANSACTIONAL',
          incidentId: 'incident',
          payload: expect.objectContaining({
            lifecyclePolicy: expect.objectContaining({
              expectedStatus: status,
              escalationGeneration: 2,
            }),
          }),
        }),
        { dispatchImmediately: false }
      );
    }
  );
  it('retains immediate critical dispatch for new service-triggered pages', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValue(incident('OPEN') as never);
    expect(await sendServiceNotifications('incident', 'triggered')).toEqual({ success: true });
    expect(enqueueCentralNotification).toHaveBeenCalledWith(
      expect.objectContaining({ trafficClass: 'CRITICAL' }),
      { dispatchImmediately: true }
    );
  });
  it('does not hand off stale lifecycle work', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValue(incident('RESOLVED') as never);
    await sendServiceNotifications('incident', 'acknowledged');
    expect(enqueueCentralNotification).not.toHaveBeenCalled();
  });
  it('persists status webhook intents without waiting for external delivery', async () => {
    vi.mocked(prisma.statusPageWebhook.findMany).mockResolvedValue([
      {
        id: 'webhook',
        url: 'https://receiver.example.test/status',
        secret: 'encrypted-fixture',
        events: ['incident.created'],
      },
    ] as never);
    const result = await triggerStatusPageWebhooks(
      'page',
      'incident.created',
      { id: 'incident' },
      'event-key'
    );
    expect(result).toEqual({ attempted: 1, failed: 0 });
    expect(enqueueCentralNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'webhook',
        eventKey: 'event-key',
        payload: expect.objectContaining({
          kind: 'STATUS_PAGE_WEBHOOK',
          statusPageId: 'page',
          deliveryId: expect.any(String),
        }),
      }),
      { dispatchImmediately: false }
    );
  });
  it('reports persistence failure so the durable parent can retry', async () => {
    vi.mocked(prisma.statusPageWebhook.findMany).mockResolvedValue([
      {
        id: 'webhook',
        url: 'https://receiver.example.test/status',
        secret: 'encrypted-fixture',
        events: ['incident.created'],
      },
    ] as never);
    vi.mocked(enqueueCentralNotification).mockRejectedValueOnce(
      new Error('Owned persistence failure')
    );
    expect(
      await triggerStatusPageWebhooks('page', 'incident.created', { id: 'incident' }, 'event-key')
    ).toEqual({ attempted: 0, failed: 1 });
  });
});
