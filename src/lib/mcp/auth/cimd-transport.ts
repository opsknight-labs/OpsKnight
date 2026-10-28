import 'server-only';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { McpBoundaryError, requireMcp } from '../core/errors';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  // Deprecated IPv4-compatible and unspecified/loopback space. IPv4-mapped addresses are
  // classified by the IPv4 rules above (a ::ffff:0:0/96 entry would block every IPv4 address).
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(network, prefix, 'ipv6');

/** True for loopback, private, link-local, metadata, multicast and transition-embedded addresses. */
export function isBlockedMcpAddress(address: string) {
  const family = isIP(address);
  return family === 0 || blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export interface CimdResponse {
  status: number;
  contentType: string;
  body: string;
}
export interface CimdTransportDependencies {
  resolve(host: string): Promise<{ address: string }[]>;
  /** Budget for DNS resolution alone; the request has its own timeout. */
  dnsTimeoutMs?: number;
  request(
    options: RequestOptions,
    onResponse: (response: import('node:http').IncomingMessage) => void
  ): import('node:http').ClientRequest;
}
const defaults: CimdTransportDependencies = {
  resolve: host => dnsLookup(host, { all: true, verbatim: true }),
  request: (options, onResponse) => httpsRequest(options, onResponse),
};

/** Always answers with the validated address, in the shape net.connect expects for `all`. */
export function createPinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  return (_host, options, callback) => {
    if (options.all)
      (callback as (error: null, addresses: LookupAddress[]) => void)(null, [{ address, family }]);
    else
      (callback as (error: null, address: string, family: number) => void)(null, address, family);
  };
}

export const CIMD_MAX_BYTES = 5120;
const TIMEOUT_MS = 3000;

/**
 * Fetches one HTTPS document without redirects. Every resolved address must be public and the
 * socket is pinned to the validated address, so a later DNS answer cannot redirect the request.
 */
export async function fetchPinnedMetadata(
  url: URL,
  dependencies: CimdTransportDependencies = defaults
): Promise<CimdResponse> {
  requireMcp(
    url.protocol === 'https:' && !isIP(url.hostname.replace(/^\[|\]$/g, '')),
    'invalid_client'
  );
  let addresses: { address: string }[];
  let timer: NodeJS.Timeout | undefined;
  try {
    // A slow resolver must not hold an authorization request past its budget.
    addresses = await Promise.race([
      dependencies.resolve(url.hostname),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new McpBoundaryError('MCP_CLIENT_METADATA_TIMEOUT', 504)),
          dependencies.dnsTimeoutMs ?? TIMEOUT_MS
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof McpBoundaryError) throw error;
    throw new McpBoundaryError('MCP_CLIENT_METADATA_UNAVAILABLE', 502);
  } finally {
    clearTimeout(timer);
  }
  requireMcp(
    addresses.length > 0 && addresses.length <= 16,
    'MCP_CLIENT_METADATA_UNAVAILABLE',
    502
  );
  requireMcp(
    addresses.every(entry => !isBlockedMcpAddress(entry.address)),
    'MCP_CLIENT_METADATA_FORBIDDEN',
    403
  );
  const pinned = addresses[0].address;
  return new Promise<CimdResponse>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (!settled) {
        settled = true;
        action();
      }
    };
    const fail = (code: string, status = 502) =>
      finish(() => reject(new McpBoundaryError(code, status)));
    const clientRequest = dependencies.request(
      {
        protocol: 'https:',
        host: url.hostname,
        port: 443,
        method: 'GET',
        path: `${url.pathname}`,
        servername: url.hostname,
        agent: false,
        timeout: TIMEOUT_MS,
        rejectUnauthorized: true,
        headers: {
          accept: 'application/json',
          host: url.host,
          'user-agent': 'OpsKnight-MCP-ClientMetadata/1',
        },
        lookup: createPinnedLookup(pinned),
      },
      response => {
        if (response.statusCode !== 200) {
          response.resume();
          fail('MCP_CLIENT_METADATA_UNAVAILABLE');
          return;
        }
        const contentType = String(response.headers['content-type'] ?? '');
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > CIMD_MAX_BYTES) {
            response.destroy();
            fail('MCP_CLIENT_METADATA_TOO_LARGE', 413);
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          finish(() =>
            resolve({
              status: 200,
              contentType,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          )
        );
        response.on('error', () => fail('MCP_CLIENT_METADATA_UNAVAILABLE'));
      }
    );
    clientRequest.on('timeout', () => {
      clientRequest.destroy();
      fail('MCP_CLIENT_METADATA_TIMEOUT', 504);
    });
    clientRequest.on('error', () => fail('MCP_CLIENT_METADATA_UNAVAILABLE'));
    clientRequest.end();
  });
}
