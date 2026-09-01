import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/network-security', () => ({ assertSafeOutboundUrl: vi.fn() }));
vi.mock('@/lib/circuit-breaker', () => ({
  CircuitBreakers: { webhook: () => ({ execute: (fn: () => unknown) => fn() }) },
}));

import { assertSafeOutboundUrl } from '@/lib/network-security';
import { sendWebhook } from '@/lib/webhooks';

describe('webhook delivery boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSafeOutboundUrl).mockResolvedValue(new URL('https://hooks.example.com'));
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      );
  });

  it('revalidates immediately before delivery and never follows redirects', async () => {
    const result = await sendWebhook({ url: 'https://hooks.example.com', payload: { ok: true } });
    expect(result.success).toBe(true);
    expect(assertSafeOutboundUrl).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(
      'https://hooks.example.com',
      expect.objectContaining({ redirect: 'error' })
    );
  });
});
