import { describe, expect, it } from 'vitest';
import { getClientIp } from '@/lib/client-ip';

describe('getClientIp', () => {
  it('uses the rightmost untrusted X-Forwarded-For hop', () => {
    expect(
      getClientIp(
        new Headers({
          'x-forwarded-for': '198.51.100.55, 203.0.113.10',
        })
      )
    ).toBe('203.0.113.10');
  });

  it('prefers a valid Cloudflare connecting address', () => {
    expect(
      getClientIp(
        new Headers({
          'cf-connecting-ip': '198.51.100.7',
          'x-forwarded-for': '203.0.113.9',
        })
      )
    ).toBe('198.51.100.7');
  });

  it('rejects malformed values', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': 'not-an-ip' }))).toBe('0.0.0.0');
  });
});
