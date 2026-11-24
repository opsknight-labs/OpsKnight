import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/status-pages/snapshot', () => ({ getStatusPageSnapshotByRoute: vi.fn() }));

import {
  signWebhookPayload,
  verifyWebhookSignature,
  verifyWebhookUnsubscribeToken,
  webhookUnsubscribeToken,
} from '@/lib/status-pages/subscriber-webhook-crypto';
import { validateSubscriberWebhookUrl } from '@/lib/status-pages/subscriber-webhooks';

describe('subscriber webhook signatures', () => {
  it('signs and verifies with the shared sha256 scheme', () => {
    const sig = signWebhookPayload('s3cret', '1700000000000', '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature('s3cret', '1700000000000', '{"a":1}', sig)).toBe(true);
    expect(verifyWebhookSignature('other', '1700000000000', '{"a":1}', sig)).toBe(false);
    expect(verifyWebhookSignature('s3cret', '1700000000001', '{"a":1}', sig)).toBe(false);
    expect(verifyWebhookSignature('s3cret', '1700000000000', '{"a":2}', sig)).toBe(false);
    expect(verifyWebhookSignature('s3cret', '1', '{}', 'short')).toBe(false);
  });
  it('derives a verifiable unsubscribe token bound to secret and id', () => {
    const token = webhookUnsubscribeToken('s3cret', 'wh1');
    expect(verifyWebhookUnsubscribeToken('s3cret', 'wh1', token)).toBe(true);
    expect(verifyWebhookUnsubscribeToken('s3cret', 'wh2', token)).toBe(false);
    expect(verifyWebhookUnsubscribeToken('nope', 'wh1', token)).toBe(false);
  });
});

describe('subscriber webhook URL validation (SSRF)', () => {
  it.each([
    'http://example.com/hook',
    'https://user:pw@example.com/hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.5/hook',
    'https://192.168.1.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://localhost/hook',
    'ftp://example.com/x',
    'not a url',
    '',
    `https://example.com/${'a'.repeat(2100)}`,
  ])('rejects %s', async raw => {
    expect((await validateSubscriberWebhookUrl(raw)).ok).toBe(false);
  });
});
