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

  it('rejects spoofed X-Forwarded-For and CF-Connecting-IP when trustProxy is false', () => {
    const spoofedHeaders = new Headers({
      'x-forwarded-for': '1.1.1.1',
      'cf-connecting-ip': '8.8.8.8',
    });

    const result = getClientIp(
      { headers: spoofedHeaders, ip: '203.0.113.50' },
      { trustProxy: false }
    );
    expect(result).toBe('203.0.113.50');
  });

  it('ignores spoofed headers on self-hosted direct deployment when TRUST_PROXY_HEADERS=false', () => {
    const prev = process.env.TRUST_PROXY_HEADERS;
    try {
      process.env.TRUST_PROXY_HEADERS = 'false';
      const spoofedHeaders = new Headers({
        'x-forwarded-for': '10.0.0.99',
      });
      const result = getClientIp({ headers: spoofedHeaders, ip: '198.51.100.22' });
      expect(result).toBe('198.51.100.22');
    } finally {
      process.env.TRUST_PROXY_HEADERS = prev;
    }
  });

  it('trusts forwarded headers when TRUST_PROXY_HEADERS=true', () => {
    const prev = process.env.TRUST_PROXY_HEADERS;
    try {
      process.env.TRUST_PROXY_HEADERS = 'true';
      const headers = new Headers({
        'x-forwarded-for': '203.0.113.195',
      });
      const result = getClientIp({ headers, ip: '10.0.0.1' });
      expect(result).toBe('203.0.113.195');
    } finally {
      process.env.TRUST_PROXY_HEADERS = prev;
    }
  });

  it('trusts forwarded headers when socket IP matches TRUSTED_PROXIES', () => {
    const prevTrust = process.env.TRUST_PROXY_HEADERS;
    const prevProxies = process.env.TRUSTED_PROXIES;
    try {
      delete process.env.TRUST_PROXY_HEADERS;
      process.env.TRUSTED_PROXIES = '127.0.0.1, 10.0.0.5';
      const headers = new Headers({
        'cf-connecting-ip': '198.51.100.88',
      });
      const result = getClientIp({ headers, ip: '10.0.0.5' });
      expect(result).toBe('198.51.100.88');

      // Untrusted peer socket
      const untrusted = getClientIp({ headers, ip: '203.0.113.99' });
      expect(untrusted).toBe('203.0.113.99');
    } finally {
      process.env.TRUST_PROXY_HEADERS = prevTrust;
      process.env.TRUSTED_PROXIES = prevProxies;
    }
  });
});
