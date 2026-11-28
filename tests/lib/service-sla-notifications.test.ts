import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  incidentFindUnique: vi.fn(),
  slackDestinations: vi.fn(),
  teamsDestinations: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: { findUnique: mocks.incidentFindUnique },
    slackDestination: { findMany: mocks.slackDestinations },
    microsoftTeamsDestination: { findMany: mocks.teamsDestinations },
  },
}));
vi.mock('@/lib/notification-control-plane', () => ({ enqueueCentralNotification: mocks.enqueue }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/encryption', () => ({
  encrypt: async (value: string) => `v3:k1:${Buffer.from(value).toString('base64')}`,
  isEncryptedSecret: (value: string) => value.startsWith('v3:'),
  decryptStoredSecret: async (value: string) =>
    value.startsWith('v3:') ? Buffer.from(value.split(':')[2], 'base64').toString() : value,
}));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ops.example.com' }));

import { sendServiceSlaNotifications, type ServiceSlaNotice } from '@/lib/service-notifications';
import { slackWebhookHandle, storeSlackWebhookUrl } from '@/lib/slack-webhook-secret';

const sla: ServiceSlaNotice = {
  breachType: 'ack',
  breached: true,
  eventKey: 'ack:breached:15',
  message: '🚨 SLA ACK BREACHED: "Database down"',
  text: '🚨 SLA ACK BREACHED: Checkout - "Database down" has breached its 15 minute SLA target.',
};

const slackDest = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `sd-${n}`,
  channelId: `C00${n}`,
  channelName: `alerts-${n}`,
  priorities: [],
  urgencies: [],
  ...extra,
});

function setService(service: Record<string, unknown>, incident: Record<string, unknown> = {}) {
  mocks.incidentFindUnique.mockResolvedValue({
    id: 'inc-1',
    title: 'Database down',
    status: 'OPEN',
    urgency: 'HIGH',
    priority: 'P1',
    assignee: null,
    service: {
      id: 'svc-1',
      name: 'Checkout',
      slackChannel: null,
      slackWebhookUrl: null,
      serviceNotificationChannels: [],
      ...service,
    },
    ...incident,
  });
}

const queued = () => mocks.enqueue.mock.calls.map(call => call[0] as Record<string, unknown>);

describe('SLA breach delivery through the shared service dispatcher', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.enqueue.mockResolvedValue({ id: 'n', created: true });
    mocks.slackDestinations.mockResolvedValue([]);
    mocks.teamsDestinations.mockResolvedValue([]);
  });

  it('notifies all three Slack destinations and the Teams channel once each', async () => {
    setService({ serviceNotificationChannels: ['SLACK', 'MICROSOFT_TEAMS'] });
    mocks.slackDestinations.mockResolvedValue([slackDest(1), slackDest(2), slackDest(3)]);
    mocks.teamsDestinations.mockResolvedValue([
      { id: 'td-1', tenantId: 'tenant', teamId: 'team', channelId: 'chan', channelName: 'ops' },
    ]);

    await expect(sendServiceSlaNotifications('inc-1', sla)).resolves.toEqual({
      success: true,
      queued: 4,
      errors: undefined,
    });

    const rows = queued();
    const slack = rows.filter(row => row.channel === 'SLACK');
    expect(slack.map(row => row.recipientAddress)).toEqual(['C001', 'C002', 'C003']);
    for (const row of slack) {
      expect(row).toMatchObject({
        category: 'SLA',
        eventKey: 'ack:breached:15',
        sourceType: 'INCIDENT_SLA',
        sourceId: 'inc-1',
        templateKey: 'sla-ack-breached',
        payload: { kind: 'SLACK_CHANNEL', additionalMessage: sla.message },
      });
    }
    const teams = rows.filter(row => row.channel === 'MICROSOFT_TEAMS');
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      recipientAddress: 'teams:td-1',
      eventKey: 'ack:breached:15',
      payload: {
        kind: 'CHAT_TEXT',
        provider: 'MICROSOFT_TEAMS',
        tenantId: 'tenant',
        teamId: 'team',
        channel: 'chan',
        text: sla.text,
        url: 'https://ops.example.com/incidents/inc-1',
      },
    });
  });

  it('keys every destination by (destination, breach state) so a re-run queues the same rows', async () => {
    setService({ serviceNotificationChannels: ['SLACK', 'MICROSOFT_TEAMS'] });
    mocks.slackDestinations.mockResolvedValue([slackDest(1), slackDest(2)]);
    mocks.teamsDestinations.mockResolvedValue([
      { id: 'td-1', tenantId: 't', teamId: 'tm', channelId: 'c' },
    ]);

    await sendServiceSlaNotifications('inc-1', sla);
    const first = queued().map(row => `${row.recipientAddress}|${row.eventKey}|${row.templateKey}`);
    mocks.enqueue.mockClear();
    await sendServiceSlaNotifications('inc-1', sla);
    const second = queued().map(row => `${row.recipientAddress}|${row.eventKey}|${row.templateKey}`);

    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
    // A different breach state is a different notice.
    mocks.enqueue.mockClear();
    await sendServiceSlaNotifications('inc-1', { ...sla, breached: false, eventKey: 'ack:warning:15' });
    expect(queued().every(row => row.eventKey === 'ack:warning:15')).toBe(true);
  });

  it('respects a destination condition and the channel checkboxes', async () => {
    setService({ serviceNotificationChannels: ['SLACK'] }, { priority: 'P3' });
    mocks.slackDestinations.mockResolvedValue([
      slackDest(1, { priorities: ['P1'] }),
      slackDest(2),
    ]);
    mocks.teamsDestinations.mockResolvedValue([
      { id: 'td-1', tenantId: 't', teamId: 'tm', channelId: 'c' },
    ]);

    await sendServiceSlaNotifications('inc-1', sla);

    // The P1-only destination is skipped; Teams is not ticked, so it is not read at all.
    expect(queued().map(row => row.recipientAddress)).toEqual(['C002']);
    expect(mocks.teamsDestinations).not.toHaveBeenCalled();

    mocks.enqueue.mockClear();
    setService({ serviceNotificationChannels: [] });
    await sendServiceSlaNotifications('inc-1', sla);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('falls back to the legacy channel, queues the service webhook as a handle, and uses the global webhook only as a last resort', async () => {
    const webhook = 'https://hooks.slack.com/services/T000/B000/topsecretvalue';
    setService({
      serviceNotificationChannels: ['SLACK'],
      slackChannel: 'incident-alerts',
      slackWebhookUrl: await storeSlackWebhookUrl(webhook),
    });
    await sendServiceSlaNotifications('inc-1', sla, { fallbackSlackWebhookUrl: 'https://hooks.slack.com/services/G/L/O' });

    const rows = queued();
    expect(rows.map(row => row.recipientAddress)).toEqual(['incident-alerts', slackWebhookHandle(webhook)]);
    expect(JSON.stringify(rows)).not.toContain('topsecretvalue');
    expect(JSON.stringify(rows)).not.toContain('hooks.slack.com/services/G/L/O');

    mocks.enqueue.mockClear();
    setService({ serviceNotificationChannels: ['SLACK'] });
    await sendServiceSlaNotifications('inc-1', sla, { fallbackSlackWebhookUrl: 'https://hooks.slack.com/services/G/L/O' });
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({
      recipientType: 'WEBHOOK',
      payload: { kind: 'SLACK_WEBHOOK', webhookUrl: 'https://hooks.slack.com/services/G/L/O' },
    });
  });

  it('reports a failed destination and still queues the others', async () => {
    setService({ serviceNotificationChannels: ['SLACK'] });
    mocks.slackDestinations.mockResolvedValue([slackDest(1), slackDest(2), slackDest(3)]);
    mocks.enqueue
      .mockResolvedValueOnce({ id: 'a', created: true })
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ id: 'c', created: true });

    const result = await sendServiceSlaNotifications('inc-1', sla);

    expect(result.success).toBe(false);
    expect(result.queued).toBe(2);
    expect(result.errors).toEqual([
      'SLA Slack channel alerts-2 notification failed: database unavailable',
    ]);
  });
});
