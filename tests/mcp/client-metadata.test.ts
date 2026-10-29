import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
} from 'node:http';
import { Readable } from 'node:stream';
import type { RequestOptions } from 'node:https';
import { describe, expect, it, vi } from 'vitest';
import {
  CIMD_MAX_BYTES,
  createPinnedLookup,
  fetchPinnedMetadata,
  isBlockedMcpAddress,
  type CimdTransportDependencies,
} from '@/lib/mcp/auth/cimd-transport';
import { isCimdClientId, parseCimdClientId, parseCimdDocument } from '@/lib/mcp/auth/cimd';

const id = 'https://client.example.com/oauth/metadata.json';
const document = (extra: Record<string, unknown> = {}) => ({
  client_id: id,
  client_name: 'Example',
  redirect_uris: ['https://client.example.com/callback'],
  token_endpoint_auth_method: 'none',
  ...extra,
});
const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify(body),
});

describe('client metadata identifiers', () => {
  it('accepts only canonical HTTPS DNS-name URLs with a path', () => {
    expect(parseCimdClientId(id).hostname).toBe('client.example.com');
    for (const bad of [
      'http://client.example.com/metadata.json',
      'https://client.example.com',
      'https://client.example.com/',
      'https://user:pw@client.example.com/m.json',
      'https://client.example.com:8443/m.json',
      'https://client.example.com/m.json?x=1',
      'https://client.example.com/m.json#frag',
      'https://client.example.com/a/../m.json',
      'https://client.example.com/./m.json',
      'https://CLIENT.example.com/m.json',
      'https://localhost/m.json',
      'https://127.0.0.1/m.json',
      'https://[::1]/m.json',
      'https://10.0.0.8/m.json',
      `https://client.example.com/${'a'.repeat(300)}`,
      'not a url',
    ])
      expect(() => parseCimdClientId(bad), bad).toThrow('invalid_client');
    expect(isCimdClientId(id)).toBe(true);
    expect(isCimdClientId('http://x')).toBe(true);
    expect(isCimdClientId('ckabc123')).toBe(false);
  });
  it('blocks loopback, private, link-local, metadata, multicast and mapped addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      'not-an-ip',
    ])
      expect(isBlockedMcpAddress(address), address).toBe(true);
    for (const address of ['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946'])
      expect(isBlockedMcpAddress(address), address).toBe(false);
  });
});

describe('client metadata documents', () => {
  it('accepts a matching public-client document', () => {
    expect(parseCimdDocument(id, json(document())).redirect_uris).toEqual([
      'https://client.example.com/callback',
    ]);
    expect(
      parseCimdDocument(id, json(document({ redirect_uris: ['http://127.0.0.1:8765/cb'] })))
        .redirect_uris
    ).toHaveLength(1);
  });
  it('selects explicitly supported public authentication from modern ChatGPT-style metadata', () => {
    const parsed = parseCimdDocument(
      id,
      json(
        document({
          token_endpoint_auth_method: 'private_key_jwt',
          token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
          jwks_uri: 'https://client.example.com/oauth/jwks.json',
        })
      )
    );
    expect(parsed.token_endpoint_auth_method).toBe('none');
  });
  it('rejects duplicate, escaped duplicate and unsafe metadata keys before validation', () => {
    for (const body of [
      JSON.stringify(document()).replace(
        '"client_name":"Example"',
        '"client_name":"Example","client_name":"Forged"'
      ),
      JSON.stringify(document()).replace(
        '"client_name":"Example"',
        '"client_name":"Example","\\u0063lient_name":"Forged"'
      ),
      JSON.stringify(document()).replace(
        '"client_name":"Example"',
        '"client_name":"Example","__proto__":{}'
      ),
    ])
      expect(() => parseCimdDocument(id, { ...json(document()), body })).toThrow('invalid_client');
  });
  it('rejects identity mismatch, secrets, unsafe redirects and wrong types', () => {
    for (const bad of [
      json(document({ client_id: 'https://evil.example.net/m.json' })),
      json(document({ client_secret: 's' })),
      json(document({ jwks_uri: 'https://untrusted.example.com/jwks' })),
      json(document({ token_endpoint_auth_method: 'private_key_jwt' })),
      json(document({ token_endpoint_auth_methods_supported: ['private_key_jwt'] })),
      json(document({ token_endpoint_auth_methods_supported: ['none', 'none'] })),
      json(document({ token_endpoint_auth_methods_supported: [] })),
      json(document({ jwks_uri: 'http://client.example.com/jwks' })),
      json(document({ client_id: 'invalid', jwks_uri: 'https://client.example.com/jwks' })),
      json(document({ jwks: { keys: [] } })),
      json(document({ grant_types: ['refresh_token'] })),
      json(document({ response_types: [] })),
      json(document({ token_endpoint_auth_method: 'client_secret_basic' })),
      json(document({ redirect_uris: [] })),
      json(document({ redirect_uris: ['javascript:alert(1)'] })),
      json(document({ redirect_uris: ['http://client.example.com/cb'] })),
      json(document({ redirect_uris: ['https://client.example.com/cb#x'] })),
      json(
        document({ redirect_uris: Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`) })
      ),
      json(document({ grant_types: ['password'] })),
      { ...json(document()), contentType: 'text/html' },
      { ...json(document()), status: 302 },
      { ...json(document()), body: '{"client_id":' },
      { ...json(document()), body: 'x'.repeat(CIMD_MAX_BYTES + 1) },
      { ...json(document()), body: 'null' },
    ])
      expect(() => parseCimdDocument(id, bad)).toThrow('invalid_client');
  });
});

function fakeTransport(options: {
  addresses?: string[];
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  dnsFails?: boolean;
}) {
  const captured: RequestOptions[] = [];
  const dependencies: CimdTransportDependencies = {
    resolve: async () => {
      if (options.dnsFails) throw new Error('ENOTFOUND');
      return (options.addresses ?? ['93.184.216.34']).map(address => ({ address }));
    },
    request: (requestOptions, onResponse) => {
      captured.push(requestOptions);
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => {
        const response = Readable.from([Buffer.from(options.body ?? '{}')]) as IncomingMessage;
        response.statusCode = options.status ?? 200;
        response.headers = { 'content-type': 'application/json', ...options.headers };
        queueMicrotask(() => onResponse(response));
        return request;
      }) as ClientRequest['end'];
      request.destroy = (() => request) as ClientRequest['destroy'];
      return request;
    },
  };
  return { dependencies, captured };
}

describe('pinned metadata transport', () => {
  const url = new URL(id);
  it('pins the connection to the validated public address and never follows redirects', async () => {
    const { dependencies, captured } = fakeTransport({ body: JSON.stringify(document()) });
    const response = await fetchPinnedMetadata(url, dependencies);
    expect(response.status).toBe(200);
    const [options] = captured;
    expect(options).toMatchObject({
      protocol: 'https:',
      port: 443,
      path: '/oauth/metadata.json',
      servername: 'client.example.com',
      rejectUnauthorized: true,
      agent: false,
    });
    let pinned = '';
    (
      options.lookup as unknown as (h: string, o: unknown, cb: (e: null, a: string) => void) => void
    )('client.example.com', {}, (_error, address) => (pinned = address));
    expect(pinned).toBe('93.184.216.34');
    expect(options.headers).not.toHaveProperty('authorization');
    expect(options.headers).not.toHaveProperty('cookie');
  });
  it('rejects any private resolution, including mixed answers (DNS rebinding)', async () => {
    for (const addresses of [['10.0.0.5'], ['93.184.216.34', '169.254.169.254'], ['::1'], []])
      await expect(
        fetchPinnedMetadata(url, fakeTransport({ addresses }).dependencies)
      ).rejects.toThrow(/MCP_CLIENT_METADATA_(FORBIDDEN|UNAVAILABLE)/);
    await expect(
      fetchPinnedMetadata(url, fakeTransport({ dnsFails: true }).dependencies)
    ).rejects.toThrow('MCP_CLIENT_METADATA_UNAVAILABLE');
  });
  it('bounds a slow DNS resolver independently of the request timeout', async () => {
    const { dependencies } = fakeTransport({});
    const started = Date.now();
    await expect(
      fetchPinnedMetadata(url, {
        ...dependencies,
        dnsTimeoutMs: 40,
        resolve: () =>
          new Promise(resolve => setTimeout(() => resolve([{ address: '93.184.216.34' }]), 2000)),
      })
    ).rejects.toThrow('MCP_CLIENT_METADATA_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('rejects redirects, errors and oversized documents', async () => {
    for (const status of [301, 302, 307, 404, 500])
      await expect(
        fetchPinnedMetadata(
          url,
          fakeTransport({ status, headers: { location: 'http://127.0.0.1/' } }).dependencies
        )
      ).rejects.toThrow('MCP_CLIENT_METADATA_UNAVAILABLE');
    await expect(
      fetchPinnedMetadata(url, fakeTransport({ body: 'x'.repeat(CIMD_MAX_BYTES + 1) }).dependencies)
    ).rejects.toThrow('MCP_CLIENT_METADATA_TOO_LARGE');
  });
  it('enforces a total deadline even when an upstream keeps sending body bytes', async () => {
    vi.useFakeTimers();
    const response = new Readable({ read() {} }) as IncomingMessage;
    response.statusCode = 200;
    response.headers = { 'content-type': 'application/json' };
    const request = new EventEmitter() as ClientRequest;
    request.end = (() => {
      queueMicrotask(() => onResponse(response));
      return request;
    }) as ClientRequest['end'];
    request.destroy = vi.fn(() => request) as ClientRequest['destroy'];
    let onResponse: (incoming: IncomingMessage) => void;
    const dependencies: CimdTransportDependencies = {
      resolve: async () => [{ address: '93.184.216.34' }],
      request: (_options, callback) => {
        onResponse = callback;
        return request;
      },
    };
    try {
      const pending = fetchPinnedMetadata(url, dependencies);
      const rejected = expect(pending).rejects.toMatchObject({
        code: 'MCP_CLIENT_METADATA_TIMEOUT',
        status: 504,
      });
      await vi.advanceTimersByTimeAsync(0);
      response.emit('data', Buffer.from('{'));
      await vi.advanceTimersByTimeAsync(2999);
      response.emit('data', Buffer.from(' '));
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(request.destroy).toHaveBeenCalled();
      expect(response.destroyed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      response.destroy();
      vi.useRealTimers();
    }
  });
  it('refuses non-HTTPS and IP-literal targets before resolving', async () => {
    const { dependencies } = fakeTransport({});
    await expect(
      fetchPinnedMetadata(new URL('http://client.example.com/m.json'), dependencies)
    ).rejects.toThrow();
    await expect(
      fetchPinnedMetadata(new URL('https://127.0.0.1/m.json'), dependencies)
    ).rejects.toThrow();
  });
});

describe('pinned lookup on a real socket', () => {
  it('connects to the pinned address whatever the hostname resolves to, with and without autoSelectFamily', async () => {
    const server = createServer((_request, response) => response.end('pinned'));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      for (const autoSelectFamily of [true, false]) {
        const body = await new Promise<string>((resolve, reject) => {
          const options: RequestOptions & { autoSelectFamily: boolean } = {
            host: 'never-resolved.invalid',
            port,
            path: '/',
            agent: false,
            autoSelectFamily,
            lookup: createPinnedLookup('127.0.0.1'),
          };
          const request = httpRequest(options, response => {
            let text = '';
            response.on('data', chunk => (text += chunk));
            response.on('end', () => resolve(text));
          });
          request.on('error', reject);
          request.end();
        });
        expect(body).toBe('pinned');
      }
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
