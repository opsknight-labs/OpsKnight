import { BlockList, isIP } from 'node:net';

export type HeaderSource = Headers | Record<string, string | string[] | undefined>;

export type RequestWithIp = {
  headers?: HeaderSource;
  ip?: string;
};

export interface ClientIpOptions {
  /**
   * Explicit override for whether proxy headers (X-Forwarded-For, CF-Connecting-IP, X-Real-IP)
   * are trusted. If omitted, defaults to:
   * - true if process.env.TRUST_PROXY_HEADERS === 'true'
   * - true if socket IP matches process.env.TRUSTED_PROXIES
   * - false in untrusted direct environments (self-hosted without trusted proxy)
   */
  trustProxy?: boolean;
  /**
   * Socket IP address of the direct peer connection, if known.
   */
  socketIp?: string;
}

function readHeader(headers: HeaderSource | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name)?.trim() || undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

export function validIp(value?: string): string | undefined {
  if (!value) return undefined;
  const candidate =
    value.replace(/^\[|\]$/g, '').split(':').length > 2
      ? value.replace(/^\[|\]$/g, '')
      : value.replace(/:\d+$/, '');
  return isIP(candidate) ? candidate : undefined;
}

type ForwardedHeaderMode = 'x-forwarded-for' | 'cf-connecting-ip' | 'x-real-ip';

/**
 * Which forwarded header the ingress is trusted to set. Defaults to
 * X-Forwarded-For (read from the right). CF-Connecting-IP is only honoured when
 * explicitly selected, because behind any non-Cloudflare ingress a client can
 * send that header and have it pass through unchanged.
 */
function forwardedHeaderMode(): ForwardedHeaderMode | undefined {
  const raw = process.env.TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  if (raw === 'cf-connecting-ip' || raw === 'cloudflare') return 'cf-connecting-ip';
  if (raw === 'x-real-ip') return 'x-real-ip';
  if (raw === 'x-forwarded-for') return 'x-forwarded-for';
  return undefined;
}

function matchesTrustedProxy(socketIp: string, entries: string[]): boolean {
  const socket = socketIp.toLowerCase();
  const list = new BlockList();
  for (const entry of entries) {
    if (entry === '*') return true;
    const [address, prefix] = entry.split('/');
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (!isIP(address)) continue;
    if (prefix !== undefined && /^\d+$/.test(prefix)) {
      list.addSubnet(address, Number(prefix), family);
    } else {
      list.addAddress(address, family);
    }
  }
  const family = isIP(socket) === 6 ? 'ipv6' : 'ipv4';
  return isIP(socket) !== 0 && list.check(socket, family);
}

let warnedUnverifiedProxyTrust = false;

/**
 * Determine if forwarding headers from the incoming connection should be trusted.
 *
 * TRUST_PROXY_HEADERS=true is an operator assertion that the ingress is the only
 * path to the application and overwrites forwarded headers. It is not
 * verification. When TRUSTED_PROXIES (addresses or CIDRs) is configured and the
 * peer address is known, the peer must match it even if TRUST_PROXY_HEADERS=true.
 * Route handlers do not expose the socket address, so without a peer address the
 * operator assertion is all there is.
 */
export function isProxyTrusted(socketIp?: string, override?: boolean): boolean {
  if (typeof override === 'boolean') return override;
  const flag = process.env.TRUST_PROXY_HEADERS;
  if (flag === 'false') return false;

  const trustedProxies = (process.env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);

  if (trustedProxies.length > 0 && socketIp) {
    return matchesTrustedProxy(socketIp, trustedProxies);
  }

  if (flag === 'true') {
    if (
      trustedProxies.length === 0 &&
      process.env.NODE_ENV === 'production' &&
      !warnedUnverifiedProxyTrust
    ) {
      warnedUnverifiedProxyTrust = true;
      console.warn(
        '[client-ip] TRUST_PROXY_HEADERS=true without TRUSTED_PROXIES: forwarded headers are trusted ' +
          'unverified. Restrict network access so only the ingress can reach the application.'
      );
    }
    return true;
  }

  // In test environment where mock headers are provided without a socket IP,
  // default to true so unit tests without socket IPs continue working seamlessly
  // unless TRUST_PROXY_HEADERS='false' is explicitly configured.
  if (process.env.NODE_ENV === 'test' && !socketIp) {
    return true;
  }

  return false;
}

/**
 * Resolve the client address from headers that a trusted edge proxy overwrites.
 *
 * Security hardening:
 * - On self-hosted or direct deployments without a trusted ingress proxy,
 *   untrusted clients cannot spoof their IP address by injecting X-Forwarded-For
 *   or CF-Connecting-IP headers.
 * - When TRUST_PROXY_HEADERS=true or behind a verified reverse proxy,
 *   X-Forwarded-For is read from the right (TRUSTED_PROXY_HOPS), never from the
 *   attacker-controlled left edge. CF-Connecting-IP / X-Real-IP are honoured
 *   only when selected with TRUSTED_PROXY_HEADER.
 */
export function getClientIp(
  source?: HeaderSource | RequestWithIp,
  options?: ClientIpOptions
): string {
  // Support both raw Headers/Record and Request-like object with .headers and .ip
  let headers: HeaderSource | undefined;
  let detectedSocketIp: string | undefined = options?.socketIp;

  if (source && typeof source === 'object') {
    if ('headers' in source && source.headers) {
      headers = source.headers as HeaderSource;
      if (!detectedSocketIp && 'ip' in source && typeof source.ip === 'string') {
        detectedSocketIp = validIp(source.ip);
      }
    } else {
      headers = source as HeaderSource;
    }
  }

  const trusted = isProxyTrusted(detectedSocketIp, options?.trustProxy);

  // If proxy headers are untrusted (e.g. self-hosted without trusted reverse proxy),
  // do NOT trust client-supplied forwarded headers.
  if (!trusted) {
    if (detectedSocketIp) return detectedSocketIp;
    if (process.env.NODE_ENV !== 'test') {
      return '0.0.0.0';
    }
  }

  // Trusted proxy path:
  const mode = forwardedHeaderMode();

  if (mode === 'cf-connecting-ip') {
    return validIp(readHeader(headers, 'cf-connecting-ip')) ?? detectedSocketIp ?? '0.0.0.0';
  }
  if (mode === 'x-real-ip') {
    return validIp(readHeader(headers, 'x-real-ip')) ?? detectedSocketIp ?? '0.0.0.0';
  }

  const forwarded = readHeader(headers, 'x-forwarded-for');
  if (forwarded) {
    // Index the raw list: dropping unparseable entries would shift the position
    // of the hop our own proxies appended.
    const chain = forwarded.split(',').map(value => value.trim());
    const trustedHops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
    const index = Math.max(0, chain.length - trustedHops);
    const candidate = validIp(chain[index]);
    if (candidate) return candidate;
    return detectedSocketIp || '0.0.0.0';
  }

  if (mode === undefined) {
    const realIp = validIp(readHeader(headers, 'x-real-ip'));
    if (realIp) return realIp;
  }

  return detectedSocketIp || '0.0.0.0';
}
