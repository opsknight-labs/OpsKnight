import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('dns', () => ({
  default: { promises: { lookup } },
  promises: { lookup },
}));

import { assertSafeOutboundUrl, isPrivateIp, validateWebhookUrl } from '@/lib/network-security';

describe('outbound URL security', () => {
  beforeEach(() => lookup.mockReset());

  it('blocks private addresses in mixed DNS answers', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(validateWebhookUrl('https://hooks.example.com')).resolves.toBe(false);
  });

  it('rejects URL credentials and non-HTTPS URLs when required', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertSafeOutboundUrl('https://user:pass@example.com')).rejects.toThrow(
      'credentials'
    );
    await expect(
      assertSafeOutboundUrl('http://example.com', { requireHttps: true })
    ).rejects.toThrow('HTTPS');
  });

  it('blocks reserved IPv6 ranges', () => {
    expect(isPrivateIp('::')).toBe(true);
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIp('::7f00:1')).toBe(true);
    expect(isPrivateIp('fe90::1')).toBe(true);
    expect(isPrivateIp('2001:db8::1')).toBe(true);
    expect(isPrivateIp('ff02::1')).toBe(true);
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
  });
});
