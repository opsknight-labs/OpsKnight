import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeEscalation as mockedExecuteEscalation } from '@/lib/notifications';
import { sendServiceNotifications as mockedSendServiceNotifications } from '@/lib/service-notifications';
import { sendIncidentNotifications as mockedSendIncidentNotifications } from '@/lib/user-notifications';
import { triggerWebhooksForService as mockedTriggerWebhooksForService } from '@/lib/status-page-webhooks';
import prisma from '@/lib/prisma';
import { processEventSideEffect } from '@/lib/event-side-effects';
import type { EventSideEffectPayload } from '@/lib/event-outbox';

type TestMock = ReturnType<typeof vi.fn>;

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/notifications', () => ({
  executeEscalation: vi.fn(),
}));

vi.mock('@/lib/service-notifications', () => ({
  sendServiceNotifications: vi.fn(),
}));

vi.mock('@/lib/user-notifications', () => ({
  sendIncidentNotifications: vi.fn(),
}));

vi.mock('@/lib/status-page-webhooks', () => ({
  triggerWebhooksForService: vi.fn(),
}));

vi.mock('@/lib/slack', () => ({
  notifySlackForIncident: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/chatops/war-room', () => ({
  createIncidentWarRoom: vi.fn(),
  archiveWarRoomChannel: vi.fn(),
}));

const executeEscalationMock = mockedExecuteEscalation as unknown as TestMock;
const sendServiceNotificationsMock = mockedSendServiceNotifications as unknown as TestMock;
const sendIncidentNotificationsMock = mockedSendIncidentNotifications as unknown as TestMock;
const triggerWebhooksForServiceMock = mockedTriggerWebhooksForService as unknown as TestMock;
const prismaMock = prisma as unknown as { incident: { findUnique: TestMock } };

function payload(
  effect: EventSideEffectPayload['effect'],
  lane: EventSideEffectPayload['lane'] = 'ESCALATION'
): EventSideEffectPayload {
  return {
    task: 'EVENT_SIDE_EFFECT',
    effect,
    lane,
    incidentId: 'inc-1',
    eventOrderAt: new Date().toISOString(),
  };
}

describe('event durable side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses service notification fallback only when escalation execution fails', async () => {
    executeEscalationMock.mockRejectedValue(new Error('escalation unavailable'));
    sendServiceNotificationsMock.mockResolvedValue(undefined);

    await expect(
      processEventSideEffect(payload('TRIGGER_ESCALATION_NOTIFICATIONS'))
    ).resolves.toBeUndefined();

    expect(sendServiceNotificationsMock).toHaveBeenCalledTimes(1);
    expect(sendIncidentNotificationsMock).not.toHaveBeenCalled();
  });

  it('lets notification-provider failure escape so the durable job retries', async () => {
    executeEscalationMock.mockResolvedValue({
      escalated: false,
      reason: 'No escalation policy configured',
    });
    sendIncidentNotificationsMock.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      processEventSideEffect(payload('TRIGGER_ESCALATION_NOTIFICATIONS'))
    ).rejects.toThrow('provider unavailable');

    expect(sendIncidentNotificationsMock).toHaveBeenCalledTimes(1);
    expect(sendServiceNotificationsMock).not.toHaveBeenCalled();
  });

  it('keeps created webhook lifecycle state even if the incident has since resolved', async () => {
    prismaMock.incident.findUnique.mockResolvedValue({
      id: 'inc-1',
      title: 'Incident',
      description: null,
      status: 'RESOLVED',
      urgency: 'HIGH',
      priority: 'P1',
      serviceId: 'svc-1',
      service: { id: 'svc-1', name: 'Service' },
      assignee: null,
      createdAt: new Date('2026-08-26T12:00:00Z'),
      acknowledgedAt: null,
      resolvedAt: new Date('2026-08-26T12:01:00Z'),
    });
    triggerWebhooksForServiceMock.mockResolvedValue(undefined);

    await processEventSideEffect(payload('TRIGGER_WEBHOOK', 'WEBHOOK'));

    expect(triggerWebhooksForServiceMock).toHaveBeenCalledWith(
      'svc-1',
      'incident.created',
      expect.objectContaining({ status: 'OPEN' })
    );
  });

  it('rejects an unknown effect instead of silently completing it', async () => {
    const invalid = {
      ...payload('ACK_SLACK', 'SLACK'),
      effect: 'UNKNOWN_EFFECT',
    } as unknown as EventSideEffectPayload;

    await expect(processEventSideEffect(invalid)).rejects.toThrow(/Unknown EVENT_SIDE_EFFECT effect/);
  });
});
