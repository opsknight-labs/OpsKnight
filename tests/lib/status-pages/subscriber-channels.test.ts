import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  batch: vi.fn(),
  tokens: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: { statusPageSubscription: { findMany: mocks.findMany } },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/encryption', () => ({ decryptStoredSecret: mocks.decrypt }));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ops.example' }));
vi.mock('@/lib/status-page-url', () => ({
  getStatusPagePublicUrl: () => 'https://status.example',
}));
vi.mock('@/lib/notification-control-plane', () => ({
  createCentralNotificationIntentsBatch: mocks.batch,
}));
vi.mock('@/lib/status-pages/subscription-tokens', () => ({
  issueUnsubscribeTokensBatch: mocks.tokens,
}));

import {
  channelSubscriberKey,
  isChatWebhookHost,
  pageSubscriberChannels,
  smsUpdateText,
} from '@/lib/status-pages/subscriber-channel-policy';
import { notifyChannelSubscribers } from '@/lib/status-pages/subscriber-channels';

describe('subscriber channel policy', () => {
  it('defaults to email and webhook and drops unknown channels', () => {
    expect(pageSubscriberChannels({})).toEqual(['EMAIL', 'WEBHOOK']);
    expect(pageSubscriberChannels({ subscriberChannels: ['SMS', 'FAX', 'EMAIL'] })).toEqual([
      'EMAIL',
      'SMS',
    ]);
    expect(pageSubscriberChannels({ subscriberChannels: [] })).toEqual([]);
  });

  it('keys rows so the same phone or webhook is one subscription per page', () => {
    expect(channelSubscriberKey('SMS', '+14155550100')).toBe('sms:+14155550100');
    const a = channelSubscriberKey('SLACK', 'https://hooks.slack.com/services/T/B/x');
    expect(a).toMatch(/^slack:[0-9a-f]{40}$/);
    expect(channelSubscriberKey('SLACK', 'https://hooks.slack.com/services/T/B/x')).toBe(a);
    expect(channelSubscriberKey('MICROSOFT_TEAMS', 'https://x.webhook.office.com/a')).toMatch(
      /^teams:/
    );
  });

  it('accepts only Slack and Microsoft webhook hosts', () => {
    const ok = (channel: 'SLACK' | 'MICROSOFT_TEAMS', url: string) =>
      isChatWebhookHost(channel, new URL(url));
    expect(ok('SLACK', 'https://hooks.slack.com/services/T0/B0/abc')).toBe(true);
    expect(ok('SLACK', 'https://hooks.slack.com/other')).toBe(false);
    expect(ok('SLACK', 'https://hooks.slack.com.evil.example/services/x')).toBe(false);
    expect(ok('MICROSOFT_TEAMS', 'https://acme.webhook.office.com/webhookb2/x')).toBe(true);
    expect(ok('MICROSOFT_TEAMS', 'https://prod-1.westus.logic.azure.com/workflows/x')).toBe(true);
    expect(ok('MICROSOFT_TEAMS', 'https://evil.example/webhook.office.com')).toBe(false);
    expect(ok('MICROSOFT_TEAMS', 'https://hooks.slack.com/services/x')).toBe(false);
  });

  it('keeps SMS short and always ends with the stop link', () => {
    const text = smsUpdateText(
      'x'.repeat(500),
      'https://status.example',
      'https://status.example/unsubscribe/t'
    );
    expect(text.length).toBeLessThanOrEqual(320);
    expect(text.endsWith('Stop: https://status.example/unsubscribe/t')).toBe(true);
  });
});

describe('notifyChannelSubscribers', () => {
  const page = { id: 'p1', subscriberChannels: ['EMAIL', 'SMS', 'SLACK'] };
  const input = {
    page,
    serviceIds: ['s1'],
    title: '[Acme] Investigating: Login errors',
    message: 'We are looking into it.',
    eventKey: 'evt-1',
    templateKey: 'status-page-incident-investigating',
    sourceType: 'STATUS_PAGE_INCIDENT',
    sourceId: 'p1:i1',
    incidentId: 'i1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokens.mockImplementation(
      async (ids: string[]) => new Map(ids.map(id => [id, `t-${id}`]))
    );
    mocks.batch.mockImplementation(async (intents: unknown[]) => ({
      created: intents.length,
      skipped: 0,
    }));
    mocks.decrypt.mockResolvedValue('https://hooks.slack.com/services/T/B/x');
  });

  it('sends nothing and reads nothing when the page offers no extra channels', async () => {
    expect(await notifyChannelSubscribers({ ...input, page: { id: 'p1' } })).toBe(0);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('queries only enabled channels and the followed services, and queues one intent each', async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: 'sub-sms', channel: 'SMS', phone: '+14155550100', targetEncrypted: null },
      { id: 'sub-slack', channel: 'SLACK', phone: null, targetEncrypted: 'enc' },
    ]);
    expect(await notifyChannelSubscribers(input)).toBe(2);
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      statusPageId: 'p1',
      channel: { in: ['SLACK', 'SMS'] },
      state: 'ACTIVE',
      verified: true,
      unsubscribedAt: null,
    });
    expect(where.OR).toBeDefined();
    const [sms, slack] = mocks.batch.mock.calls[0][0];
    expect(sms).toMatchObject({
      channel: 'SMS',
      recipientType: 'SUBSCRIBER',
      recipientId: 'sub-sms',
      eventKey: 'evt-1',
      payload: { kind: 'SMS', to: '+14155550100' },
    });
    expect(sms.payload.message).toContain('https://status.example/unsubscribe/t-sub-sms');
    expect(slack).toMatchObject({
      channel: 'WEBHOOK',
      recipientId: 'sub-slack',
      payload: { kind: 'WEBHOOK', url: 'https://hooks.slack.com/services/T/B/x' },
    });
    expect(JSON.stringify(slack.payload.payload)).toContain('unsubscribe/t-sub-slack');
  });

  it('follows the whole page when the update is not scoped to services', async () => {
    mocks.findMany.mockResolvedValueOnce([]);
    await notifyChannelSubscribers({ ...input, serviceIds: null });
    expect(mocks.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it('skips a chat subscriber whose stored URL cannot be decrypted', async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: 'sub-slack', channel: 'SLACK', phone: null, targetEncrypted: 'enc' },
    ]);
    mocks.decrypt.mockRejectedValueOnce(new Error('bad key'));
    expect(await notifyChannelSubscribers(input)).toBe(0);
    expect(mocks.batch).not.toHaveBeenCalled();
  });
});
