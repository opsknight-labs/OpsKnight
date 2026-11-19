import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/network-security', () => ({
  assertSafeOutboundUrl: vi.fn(),
  safeOutboundFetch: vi.fn(),
}));
vi.mock('@/lib/circuit-breaker', () => ({
  CircuitBreakers: { webhook: () => ({ execute: (fn: () => unknown) => fn() }) },
}));

import { assertSafeOutboundUrl, safeOutboundFetch } from '@/lib/network-security';
import { sendWebhook } from '@/lib/webhooks';

describe('webhook delivery boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSafeOutboundUrl).mockResolvedValue(new URL('https://hooks.example.com'));
    vi.mocked(safeOutboundFetch).mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    );
  });

  it('revalidates immediately before delivery and never follows redirects', async () => {
    const result = await sendWebhook({ url: 'https://hooks.example.com', payload: { ok: true } });
    expect(result.success).toBe(true);
    expect(assertSafeOutboundUrl).toHaveBeenCalledTimes(2);
    expect(safeOutboundFetch).toHaveBeenCalledWith(
      'https://hooks.example.com',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-OpsKnight-Delivery-Id': expect.any(String) }),
      })
    );
  });

  it('uses the supplied delivery id across retries', async () => {
    await sendWebhook({
      url: 'https://hooks.example.com',
      payload: { ok: true },
      deliveryId: 'delivery-123',
    });
    expect(safeOutboundFetch).toHaveBeenCalledWith(
      'https://hooks.example.com',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-OpsKnight-Delivery-Id': 'delivery-123' }),
      })
    );
  });

  it('passes requireHttps to every URL check and does not send when it fails', async () => {
    vi.mocked(assertSafeOutboundUrl).mockImplementation(async (url, options) => {
      if (options?.requireHttps && url.startsWith('http://')) throw new Error('HTTPS is required');
      return new URL(url);
    });
    const result = await sendWebhook({
      url: 'http://tools.internal.example.com/hook',
      payload: { ok: true },
      requireHttps: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/HTTPS required/);
    expect(safeOutboundFetch).not.toHaveBeenCalled();

    await sendWebhook({ url: 'https://hooks.example.com', payload: {}, requireHttps: true });
    for (const call of vi.mocked(assertSafeOutboundUrl).mock.calls.slice(1)) {
      expect(call[1]).toEqual({ requireHttps: true });
    }
  });
});
