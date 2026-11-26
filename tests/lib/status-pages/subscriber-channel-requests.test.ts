import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  page: vi.fn(),
  findSub: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  count: vi.fn(),
  rate: vi.fn(),
  fetch: vi.fn(),
  enqueue: vi.fn(),
  smsAvailable: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    statusPage: { findUnique: mocks.page },
    statusPageSubscription: {
      findUnique: mocks.findSub,
      create: mocks.create,
      update: mocks.update,
      updateMany: mocks.updateMany,
      count: mocks.count,
    },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/encryption', () => ({ encrypt: async (v: string) => `enc(${v})` }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '203.0.113.9' }));
vi.mock('@/lib/network-security', () => ({ safeOutboundFetch: mocks.fetch }));
vi.mock('@/lib/notification-providers', () => ({ isChannelAvailable: mocks.smsAvailable }));
vi.mock('@/lib/notification-control-plane', () => ({ enqueueCentralNotification: mocks.enqueue }));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ops.example' }));
vi.mock('@/lib/status-page-url', () => ({
  getStatusPagePublicUrl: () => 'https://status.example',
}));
vi.mock('@/lib/status-pages/public-access', () => ({ getOpenStatusSnapshot: mocks.snapshot }));
vi.mock('@/lib/status-pages/subscriber-webhooks', () => ({
  validateSubscriberWebhookUrl: async (raw: string) => ({ ok: true, url: new URL(raw) }),
}));
vi.mock('@/lib/status-pages/subscriptions', () => ({
  resolveSubscriptionSelection: async () => ({
    provided: false,
    preferences: null,
    serviceIds: null,
    businessServiceIds: [],
  }),
  syncSubscriptionSelection: mocks.sync,
}));

import {
  subscribeChatRequest,
  subscribeSmsRequest,
  verifySmsRequest,
} from '@/lib/status-pages/subscriber-channel-requests';
import { hashSubscriptionToken } from '@/lib/status-pages/subscription-tokens';

const post = (body: unknown) =>
  new NextRequest('https://status.example/api/status/acme/subscribe/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
const page = (channels: string[]) => ({
  id: 'p1',
  name: 'Acme',
  organizationName: null,
  enabled: true,
  subscriberChannels: channels,
});
const SLACK_URL = 'https://hooks.slack.com/services/T0/B0/abc';

describe('chat subscriber requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rate.mockResolvedValue({ allowed: true });
    mocks.snapshot.mockResolvedValue({ page: { id: 'p1', showSubscribe: true } });
    mocks.page.mockResolvedValue(page(['EMAIL', 'SLACK']));
    mocks.findSub.mockResolvedValue(null);
    mocks.count.mockResolvedValue(0);
    mocks.fetch.mockResolvedValue({ ok: true });
    mocks.create.mockResolvedValue({ id: 'sub1' });
  });

  it('404s when the page has the channel switched off', async () => {
    mocks.page.mockResolvedValue(page(['EMAIL']));
    const response = await subscribeChatRequest(post({ channel: 'SLACK', url: SLACK_URL }), 'acme');
    expect(response.status).toBe(404);
  });

  it('rejects a URL that is not a Slack incoming webhook', async () => {
    const response = await subscribeChatRequest(
      post({ channel: 'SLACK', url: 'https://example.com/hook' }),
      'acme'
    );
    expect(response.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('stays inactive when the webhook refuses the test message', async () => {
    mocks.fetch.mockResolvedValue({ ok: false });
    const response = await subscribeChatRequest(post({ channel: 'SLACK', url: SLACK_URL }), 'acme');
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('activates after the test message, storing the URL encrypted and keyed by its hash', async () => {
    const response = await subscribeChatRequest(post({ channel: 'SLACK', url: SLACK_URL }), 'acme');
    expect(response.status).toBe(201);
    const body = JSON.parse(String(mocks.fetch.mock.calls[0][1].body));
    expect(JSON.stringify(body)).toContain('https://status.example/unsubscribe/');
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      statusPageId: 'p1',
      channel: 'SLACK',
      state: 'ACTIVE',
      verified: true,
      targetEncrypted: `enc(${SLACK_URL})`,
    });
    expect(data.email).toMatch(/^slack:[0-9a-f]{40}$/);
    expect(data.email).not.toContain('hooks.slack.com');
    expect(mocks.sync).toHaveBeenCalledWith('sub1', expect.anything());
  });

  it('answers the same for an active subscription without re-sending', async () => {
    mocks.findSub.mockResolvedValue({ id: 'sub1', state: 'ACTIVE' });
    const response = await subscribeChatRequest(post({ channel: 'SLACK', url: SLACK_URL }), 'acme');
    expect(response.status).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('is rate limited', async () => {
    mocks.rate.mockResolvedValueOnce({ allowed: false });
    const response = await subscribeChatRequest(post({ channel: 'SLACK', url: SLACK_URL }), 'acme');
    expect(response.status).toBe(429);
  });
});

describe('SMS subscriber requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rate.mockResolvedValue({ allowed: true });
    mocks.snapshot.mockResolvedValue({ page: { id: 'p1', showSubscribe: true } });
    mocks.page.mockResolvedValue(page(['EMAIL', 'SMS']));
    mocks.findSub.mockResolvedValue(null);
    mocks.count.mockResolvedValue(0);
    mocks.smsAvailable.mockResolvedValue(true);
    mocks.create.mockResolvedValue({ id: 'sub1' });
    mocks.enqueue.mockResolvedValue({ id: 'n1', created: true });
  });

  it('needs a number with a country code', async () => {
    const response = await subscribeSmsRequest(post({ phone: '4155550100' }), 'acme');
    expect(response.status).toBe(400);
  });

  it('creates a pending row and texts a 6-digit code it stores only as a hash', async () => {
    const response = await subscribeSmsRequest(post({ phone: '+1 (415) 555-0100' }), 'acme');
    expect(response.status).toBe(200);
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: 'sms:+14155550100',
      phone: '+14155550100',
      channel: 'SMS',
      state: 'PENDING',
      verified: false,
    });
    const message: string = mocks.enqueue.mock.calls[0][0].payload.message;
    const code = /(\d{6})/.exec(message)![1];
    expect(data.verificationToken).toBe(hashSubscriptionToken(`sms:p1:+14155550100:${code}`));
    expect(data.verificationToken).not.toContain(code);
    expect(mocks.enqueue.mock.calls[0][0]).toMatchObject({
      channel: 'SMS',
      recipientType: 'SUBSCRIBER',
      recipientId: 'sub1',
    });
  });

  it('refuses when no SMS provider is configured', async () => {
    mocks.smsAvailable.mockResolvedValue(false);
    const response = await subscribeSmsRequest(post({ phone: '+14155550100' }), 'acme');
    expect(response.status).toBe(503);
  });

  it('does not text a suppressed number but answers the same', async () => {
    mocks.findSub.mockResolvedValue({ id: 'sub1', state: 'SUPPRESSED' });
    const response = await subscribeSmsRequest(post({ phone: '+14155550100' }), 'acme');
    expect(response.status).toBe(200);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('activates on the right code and rejects a wrong or expired one', async () => {
    const token = hashSubscriptionToken('sms:p1:+14155550100:123456');
    const pending = {
      id: 'sub1',
      state: 'PENDING',
      verificationToken: token,
      verificationTokenExpiresAt: new Date(Date.now() + 60_000),
    };
    mocks.findSub.mockResolvedValue(pending);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    expect(
      (await verifySmsRequest(post({ phone: '+14155550100', code: '654321' }), 'acme')).status
    ).toBe(400);
    expect(
      (await verifySmsRequest(post({ phone: '+14155550100', code: '123456' }), 'acme')).status
    ).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub1', state: 'PENDING', verificationToken: token },
      data: {
        state: 'ACTIVE',
        verified: true,
        verificationToken: null,
        verificationTokenExpiresAt: null,
      },
    });
    mocks.findSub.mockResolvedValue({ ...pending, verificationTokenExpiresAt: new Date(0) });
    expect(
      (await verifySmsRequest(post({ phone: '+14155550100', code: '123456' }), 'acme')).status
    ).toBe(400);
  });

  it('limits verification attempts per number', async () => {
    mocks.rate.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    const response = await verifySmsRequest(
      post({ phone: '+14155550100', code: '123456' }),
      'acme'
    );
    expect(response.status).toBe(429);
  });
});
