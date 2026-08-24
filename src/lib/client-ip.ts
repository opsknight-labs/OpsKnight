import { isIP } from 'node:net';

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderSource | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name)?.trim() || undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function validIp(value?: string): string | undefined {
  if (!value) return undefined;
  const candidate =
    value.replace(/^\[|\]$/g, '').split(':').length > 2
      ? value.replace(/^\[|\]$/g, '')
      : value.replace(/:\d+$/, '');
  return isIP(candidate) ? candidate : undefined;
}

/**
 * Resolve the client address from headers that a trusted edge proxy overwrites.
 * X-Forwarded-For is read from the right, never from the attacker-controlled
 * left edge. TRUSTED_PROXY_HOPS can be raised for multiple internal proxies.
 */
export function getClientIp(headers?: HeaderSource): string {
  const cloudflare = validIp(readHeader(headers, 'cf-connecting-ip'));
  if (cloudflare) return cloudflare;

  const forwarded = readHeader(headers, 'x-forwarded-for');
  if (forwarded) {
    const chain = forwarded
      .split(',')
      .map(value => validIp(value.trim()))
      .filter(Boolean) as string[];
    const trustedHops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
    const index = Math.max(0, chain.length - trustedHops);
    if (chain[index]) return chain[index];
  }

  return validIp(readHeader(headers, 'x-real-ip')) || '0.0.0.0';
}
