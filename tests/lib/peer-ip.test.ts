import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getClientIp } from '@/lib/client-ip';
import { installPeerIpStamp, peerIpStampInstalled } from '@/lib/peer-ip';

describe('peer address for rate-limit keys', () => {
  beforeAll(() => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'false');
    vi.stubEnv('NODE_ENV', 'production');
  });
  afterAll(() => vi.unstubAllEnvs());

  it('ignores a client-supplied peer header until the stamp is installed', () => {
    expect(peerIpStampInstalled()).toBe(false);
    expect(getClientIp({ 'x-opsknight-peer-ip': '203.0.113.9' })).toBe('0.0.0.0');
  });

  it('gives every caller its own address once the server stamps the real peer', async () => {
    installPeerIpStamp();
    installPeerIpStamp(); // idempotent: a second install must not double-wrap
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(getClientIp(req.headers as Record<string, string>));
      seen.push(String(req.headers['x-opsknight-peer-ip']));
      res.end('ok');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>(resolve =>
      http
        .get(
          {
            port,
            host: '127.0.0.1',
            headers: { 'x-opsknight-peer-ip': '198.51.100.7', 'x-forwarded-for': '198.51.100.8' },
          },
          res => res.resume().on('end', resolve)
        )
        .on('error', resolve)
    );
    await new Promise(resolve => server.close(resolve));

    // The spoofed header and the spoofed X-Forwarded-For are both ignored: the TCP peer wins.
    expect(seen).toEqual(['127.0.0.1', '127.0.0.1']);
  });
});
