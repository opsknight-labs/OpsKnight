import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  incidentFindUnique: vi.fn(),
  enqueue: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: { findUnique: mocks.incidentFindUnique },
    incidentRelationship: { findFirst: vi.fn(async () => null) },
    slackDestination: { findMany: vi.fn(async () => []) },
    microsoftTeamsDestination: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('@/lib/notification-control-plane', () => ({ enqueueCentralNotification: mocks.enqueue }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/slack', () => ({
  notifySlackForIncident: vi.fn(),
  sendSlackMessageToChannel: vi.fn(),
}));
vi.mock('@/lib/webhooks', () => ({ sendIncidentWebhook: vi.fn() }));
vi.mock('@/lib/delivery-idempotency', () => ({
  deliveryMarkerId: vi.fn(() => 'marker'),
  isDeliveryComplete: vi.fn(async () => false),
  markDeliveryComplete: vi.fn(),
}));
vi.mock('@/lib/encryption', () => ({
  encrypt: async (value: string) => `v3:k1:${Buffer.from(value).toString('base64')}`,
  isEncryptedSecret: (value: string) => value.startsWith('v3:'),
  decryptStoredSecret: async (value: string) =>
    value.startsWith('v3:') ? Buffer.from(value.split(':')[2], 'base64').toString() : value,
}));

import { sendServiceNotifications } from '@/lib/service-notifications';
import { slackWebhookHandle, storeSlackWebhookUrl } from '@/lib/slack-webhook-secret';

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/topsecretvalue';

function incidentWith(service: Record<string, unknown>) {
  return {
    id: 'inc-1',
    title: 'Database down',
    status: 'OPEN',
    urgency: 'HIGH',
    priority: null,
    serviceId: 'svc-1',
    escalationStatus: null,
    escalationGeneration: 0,
    createdAt: new Date('2026-11-28T10:00:00Z'),
    updatedAt: new Date('2026-11-28T10:00:00Z'),
    acknowledgedAt: null,
    resolvedAt: null,
    assignee: null,
    service: {
      id: 'svc-1',
      name: 'Checkout',
      slackChannel: null,
      serviceNotifyOnTriggered: true,
      webhookIntegrations: [],
      ...service,
    },
  };
}

describe('service Slack webhook in the notification pipeline', () => {
  beforeEach(() => {
    mocks.incidentFindUnique.mockReset();
    mocks.enqueue.mockReset();
    mocks.enqueue.mockResolvedValue(undefined);
    mocks.warn.mockClear();
  });

  it.each([
    ['legacy plaintext', async () => WEBHOOK],
    ['encrypted', async () => storeSlackWebhookUrl(WEBHOOK)],
  ])('queues a %s webhook as a handle, never the URL or its ciphertext', async (_label, stored) => {
    const storedValue = await stored();
    mocks.incidentFindUnique.mockResolvedValue(
      incidentWith({ serviceNotificationChannels: ['SLACK'], slackWebhookUrl: storedValue })
    );

    await expect(sendServiceNotifications('inc-1', 'triggered')).resolves.toMatchObject({
      success: true,
    });

    const webhookCalls = mocks.enqueue.mock.calls
      .map(call => call[0] as Record<string, unknown>)
      .filter(input => input.recipientType === 'WEBHOOK');
    expect(webhookCalls).toHaveLength(1);
    const queued = JSON.stringify(webhookCalls[0]);
    expect(queued).not.toContain('topsecretvalue');
    expect(queued).not.toContain(storedValue);
    expect(webhookCalls[0].recipientAddress).toBe(slackWebhookHandle(WEBHOOK));
    expect(webhookCalls[0].payload).toMatchObject({
      kind: 'SLACK_WEBHOOK',
      lifecyclePolicy: {
        targetKind: 'SERVICE_SLACK_WEBHOOK',
        serviceId: 'svc-1',
        targetAddress: slackWebhookHandle(WEBHOOK),
      },
    });
  });

  it('ignores stored EMAIL/SMS/PUSH/WHATSAPP channels with one warning', async () => {
    mocks.incidentFindUnique.mockResolvedValue(
      incidentWith({ serviceNotificationChannels: ['EMAIL', 'SMS'], slackWebhookUrl: null })
    );

    await sendServiceNotifications('inc-1', 'triggered');

    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith('service_notifications.unsupported_channels_ignored', {
      serviceId: 'svc-1',
      channels: ['EMAIL', 'SMS'],
    });
  });
});
