import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { sendNotification } from '@/lib/notifications';
import * as emailModule from '@/lib/email';
import { decodeNotificationEnvelope } from '@/lib/notification-payload';
import {
  notificationEventInstant,
  notificationEventKey,
  notificationIntentId,
} from '@/lib/notification-identity';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    notification: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    incident: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    incidentEvent: { create: vi.fn() },
  },
}));
vi.mock('@/lib/email');
vi.mock('@/lib/sms', () => ({ sendIncidentSMS: vi.fn() }));
vi.mock('@/lib/push', () => ({ sendIncidentPush: vi.fn(), sendPush: vi.fn() }));
vi.mock('@/lib/whatsapp', () => ({ sendIncidentWhatsApp: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ sendIncidentWebhook: vi.fn() }));
vi.mock('@/lib/incident-push-delivery', () => ({ sendNotificationIntentPush: vi.fn() }));
vi.mock('@/lib/provider-admission', () => ({
  acquireProviderAdmission: vi.fn().mockResolvedValue({ allowed: true }),
}));

const createdAt = new Date('2026-08-30T12:00:00.000Z');
const updatedAt = new Date('2026-08-30T12:01:00.000Z');
const incident = {
  id: 'inc-1',
  title: 'Database latency',
  description: 'Latency above threshold',
  status: 'OPEN',
  urgency: 'HIGH',
  priority: 'P1',
  serviceId: 'svc-1',
  createdAt,
  updatedAt,
  acknowledgedAt: null,
  resolvedAt: null,
  currentEscalationStep: null,
  nextEscalationAt: null,
  escalationStatus: null,
  service: { id: 'svc-1', name: 'Payments', webhookUrl: null },
  assignee: null,
  team: null,
};

function intentIdFor(
  message: string,
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated' = 'triggered',
  incidentValue: Parameters<typeof notificationEventInstant>[0] = incident
) {
  const eventAt = notificationEventInstant(incidentValue, eventType);
  const eventKey = notificationEventKey({ incident: incidentValue, eventType, message });
  return notificationIntentId({
    eventKey,
    eventType,
    eventAt,
    userId: 'user-1',
    channel: 'EMAIL',
  });
}

function pendingIntent(id: string) {
  return { id, attempts: 0, status: 'PENDING', errorMsg: null } as never;
}

describe('durable notification intents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.incident.findUnique).mockResolvedValue(incident as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: 'Responder', email: 'r@example.com' } as never);
    vi.mocked(prisma.notification.update).mockResolvedValue({} as never);
    vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as never);
  });

  it('creates one deterministic EMAIL intent and renders from its immutable payload', async () => {
    const message = '[Payments] Database latency';
    const notificationId = intentIdFor(message);
    vi.mocked(prisma.notification.create).mockResolvedValue(pendingIntent(notificationId));
    vi.mocked(emailModule.sendIncidentEmail).mockResolvedValue({ success: true });

    const result = await sendNotification('inc-1', 'user-1', 'EMAIL', message);

    expect(result).toMatchObject({ success: true, outcome: 'DELIVERED', notificationId });
    expect(result.notificationId).toMatch(/^ntf:triggered:/);
    const createCall = vi.mocked(prisma.notification.create).mock.calls[0]?.[0];
    const durableMessage = createCall?.data.message;
    expect(typeof durableMessage).toBe('string');
    const envelope = decodeNotificationEnvelope(String(durableMessage));
    expect(envelope?.snapshot).toMatchObject({
      incidentId: 'inc-1',
      title: 'Database latency',
      status: 'OPEN',
      eventType: 'triggered',
    });
    expect(emailModule.sendIncidentEmail).toHaveBeenCalledWith(
      'user-1',
      'inc-1',
      'triggered',
      notificationId,
      durableMessage
    );
  });

  it('uses the database primary key as the concurrency idempotency boundary', async () => {
    const notificationId = intentIdFor('same event');
    vi.mocked(prisma.notification.create).mockRejectedValueOnce({ code: 'P2002' });
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: notificationId,
      status: 'SENT',
      attempts: 0,
      errorMsg: null,
    } as never);

    const result = await sendNotification('inc-1', 'user-1', 'EMAIL', 'same event');

    expect(result).toMatchObject({
      success: true,
      outcome: 'DELIVERED',
      notificationId,
      deduped: true,
    });
    expect(emailModule.sendIncidentEmail).not.toHaveBeenCalled();
  });

  it('does not let a failed persisted channel make the parent replay it', async () => {
    const notificationId = intentIdFor('failure');
    vi.mocked(prisma.notification.create).mockResolvedValue(pendingIntent(notificationId));
    vi.mocked(emailModule.sendIncidentEmail).mockResolvedValue({ success: false, error: 'SMTP down' });

    const result = await sendNotification('inc-1', 'user-1', 'EMAIL', 'failure');

    expect(result).toMatchObject({
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      error: 'SMTP down',
      notificationId,
    });
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', attempts: 1 }) })
    );
  });

  it('creates a distinct durable intent for a real later lifecycle event', async () => {
    const triggeredId = intentIdFor('trigger');
    const resolvedIncident = {
      ...incident,
      status: 'RESOLVED',
      resolvedAt: new Date('2026-08-30T12:03:00.000Z'),
      updatedAt: new Date('2026-08-30T12:03:00.000Z'),
    };
    const resolvedId = intentIdFor('resolve', 'resolved', resolvedIncident);
    vi.mocked(prisma.notification.create)
      .mockResolvedValueOnce(pendingIntent(triggeredId))
      .mockResolvedValueOnce(pendingIntent(resolvedId));
    vi.mocked(emailModule.sendIncidentEmail).mockResolvedValue({ success: true });

    await sendNotification('inc-1', 'user-1', 'EMAIL', 'trigger', undefined, 'triggered');
    vi.mocked(prisma.incident.findUnique).mockResolvedValue(resolvedIncident as never);
    await sendNotification('inc-1', 'user-1', 'EMAIL', 'resolve', undefined, 'resolved');

    expect(triggeredId).not.toBe(resolvedId);
    expect(resolvedId).toContain(':resolved:');
  });

  it('keeps unavailable push recipients terminally skipped', async () => {
    const { sendNotificationIntentPush } = await import('@/lib/incident-push-delivery');
    const eventAt = notificationEventInstant(incident, 'triggered');
    const eventKey = notificationEventKey({ incident, eventType: 'triggered', message: 'push' });
    const pushId = notificationIntentId({
      eventKey,
      eventType: 'triggered',
      eventAt,
      userId: 'user-1',
      channel: 'PUSH',
    });
    vi.mocked(prisma.notification.create).mockResolvedValue(pendingIntent(pushId));
    vi.mocked(sendNotificationIntentPush).mockResolvedValue({
      success: false,
      code: 'NO_DEVICE_TOKENS',
      error: 'No device tokens',
    });

    const result = await sendNotification('inc-1', 'user-1', 'PUSH', 'push');

    expect(result).toMatchObject({ success: true, outcome: 'SKIPPED', skipped: true });
  });
});
