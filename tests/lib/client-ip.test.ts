import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClientIp } from '@/lib/client-ip';

describe('getClientIp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the rightmost untrusted X-Forwarded-For hop', () => {
    expect(
      getClientIp(
        new Headers({
          'x-forwarded-for': '198.51.100.55, 203.0.113.10',
        })
      )
    ).toBe('203.0.113.10');
  });

  it('prefers a valid Cloudflare connecting address when TRUSTED_PROXY_HEADER selects it', () => {
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'cf-connecting-ip');
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
      vi.stubEnv('TRUSTED_PROXY_HEADER', 'cf-connecting-ip');
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

describe('getClientIp proxy trust hardening', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ignores a spoofed CF-Connecting-IP behind a non-Cloudflare ingress', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    const headers = new Headers({
      'cf-connecting-ip': '1.2.3.4',
      'x-forwarded-for': '1.2.3.4, 203.0.113.10',
    });
    expect(getClientIp({ headers })).toBe('203.0.113.10');
  });

  it('does not let a spoofed left-edge X-Forwarded-For entry win', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
    const headers = new Headers({ 'x-forwarded-for': '6.6.6.6, 198.51.100.4, 10.1.1.1' });
    expect(getClientIp({ headers })).toBe('198.51.100.4');
  });

  it('does not shift hop positions when a proxy-appended entry is unparseable', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.4, unknown' });
    expect(getClientIp({ headers, ip: '10.0.0.9' })).toBe('10.0.0.9');
  });

  it('honours TRUSTED_PROXIES CIDRs even when TRUST_PROXY_HEADERS=true and the peer is known', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    vi.stubEnv('TRUSTED_PROXIES', '10.0.0.0/8');
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.4' });
    expect(getClientIp({ headers, ip: '10.2.3.4' })).toBe('198.51.100.4');
    expect(getClientIp({ headers, ip: '203.0.113.77' })).toBe('203.0.113.77');
  });

  it('only honours X-Real-IP in the default mode or when selected', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    const headers = new Headers({ 'x-real-ip': '198.51.100.9', 'cf-connecting-ip': '1.2.3.4' });
    expect(getClientIp({ headers })).toBe('198.51.100.9');
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'x-forwarded-for');
    expect(getClientIp({ headers })).toBe('0.0.0.0');
  });
});

describe('getClientIp ingress topologies with spoofed headers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const attacker = '6.6.6.6';
  const client = '198.51.100.10';

  const topologies: Array<{
    name: string;
    env: Record<string, string>;
    headers: Record<string, string>;
    socket?: string;
    expected: string;
  }> = [
    {
      name: 'Cloudflare direct to app (CF header selected)',
      env: { TRUST_PROXY_HEADERS: 'true', TRUSTED_PROXY_HEADER: 'cf-connecting-ip' },
      // Cloudflare overwrites CF-Connecting-IP, so a spoofed value from the client is replaced.
      headers: { 'cf-connecting-ip': client, 'x-forwarded-for': `${attacker}, ${client}` },
      expected: client,
    },
    {
      name: 'Nginx (appends client to X-Forwarded-For), attacker forges CF-Connecting-IP and a left XFF entry',
      env: { TRUST_PROXY_HEADERS: 'true' },
      headers: { 'cf-connecting-ip': attacker, 'x-forwarded-for': `${attacker}, ${client}` },
      expected: client,
    },
    {
      name: 'Traefik, one trusted hop, forged X-Real-IP is ignored when XFF is present',
      env: { TRUST_PROXY_HEADERS: 'true' },
      headers: { 'x-real-ip': attacker, 'x-forwarded-for': client },
      expected: client,
    },
    {
      name: 'Two proxies (CDN then ingress), TRUSTED_PROXY_HOPS=2',
      env: { TRUST_PROXY_HEADERS: 'true', TRUSTED_PROXY_HOPS: '2' },
      headers: { 'x-forwarded-for': `${attacker}, ${client}, 10.1.1.1` },
      expected: client,
    },
    {
      name: 'Kubernetes ingress CIDR, request from a pod outside the ingress range',
      env: { TRUST_PROXY_HEADERS: 'true', TRUSTED_PROXIES: '10.42.0.0/16' },
      headers: { 'x-forwarded-for': attacker },
      socket: '10.99.0.5',
      expected: '10.99.0.5',
    },
    {
      name: 'Kubernetes ingress CIDR, request from the ingress range',
      env: { TRUST_PROXY_HEADERS: 'true', TRUSTED_PROXIES: '10.42.0.0/16' },
      headers: { 'x-forwarded-for': client },
      socket: '10.42.3.7',
      expected: client,
    },
    {
      name: 'Direct Compose, no proxy trust, forged headers ignored',
      env: { TRUST_PROXY_HEADERS: 'false' },
      headers: { 'cf-connecting-ip': attacker, 'x-forwarded-for': attacker },
      socket: '172.18.0.1',
      expected: '172.18.0.1',
    },
  ];

  it.each(topologies)('$name', ({ env, headers, socket, expected }) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    expect(getClientIp({ headers: new Headers(headers), ip: socket })).toBe(expected);
  });
});
