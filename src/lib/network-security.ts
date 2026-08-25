import { logger } from '@/lib/logger';
import dns from 'dns';

/**
 * Validates a webhook URL to prevent SSRF attacks.
 * Blocks access to private/internal IP ranges.
 */
export async function validateWebhookUrl(urlString: string): Promise<boolean> {
  try {
    const url = new URL(urlString);

    // Only allow http/https
    if (!['http:', 'https:'].includes(url.protocol)) {
      logger.warn('Webhook blocked: invalid protocol', { url: urlString, protocol: url.protocol });
      return false;
    }

    // Validate every answer, not only the resolver's first address. This closes
    // mixed public/private DNS-answer bypasses. Redirects are separately
    // disabled by the webhook sender.
    const addresses = await dns.promises.lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return false;

    const blockedAddress = addresses.find(({ address }) => isPrivateIp(address));
    if (blockedAddress) {
      logger.warn('Webhook blocked: resolved to private IP', {
        url: urlString,
        hostname: url.hostname,
        resolvedIp: blockedAddress.address,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.warn('Webhook blocked: validation failed', { url: urlString, error });
    return false;
  }
}

export function isPrivateIp(ip: string): boolean {
  const lowerIp = ip.toLowerCase();

  // IPv6 checks
  if (ip.includes(':')) {
    // Loopback
    if (lowerIp === '::1') return true;
    // Link-local (fe80::/10)
    if (lowerIp.startsWith('fe80:')) return true;
    // Unique Local Addresses (fc00::/7 includes fd00::/8)
    if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) return true;
    // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
    if (lowerIp.startsWith('::ffff:')) {
      const ipv4Part = ip.slice(7); // Extract IPv4 part
      return isPrivateIp(ipv4Part);
    }
    // Site-local (deprecated but still blocked) fec0::/10
    if (lowerIp.startsWith('fec')) return true;
    // Unspecified address and IPv4-compatible encodings.
    if (lowerIp === '::' || lowerIp.startsWith('::ffff:0:')) return true;
    // Documentation and multicast ranges.
    if (lowerIp.startsWith('2001:db8:') || lowerIp.startsWith('ff')) return true;
    return false;
  }

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true; // Invalid IP format - block it
  }

  // IPv4 Private and Reserved Ranges
  // 0.0.0.0/8 (Current network / "This" network)
  if (parts[0] === 0) return true;

  // 10.0.0.0/8 (Private - Class A)
  if (parts[0] === 10) return true;

  // 100.64.0.0/10 (Carrier-grade NAT / Shared Address Space)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (parts[0] === 127) return true;

  // 169.254.0.0/16 (Link-local / APIPA) - includes cloud metadata endpoints
  if (parts[0] === 169 && parts[1] === 254) return true;

  // 172.16.0.0/12 (Private - Class B)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1 for documentation)
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;

  // 192.168.0.0/16 (Private - Class C)
  if (parts[0] === 192 && parts[1] === 168) return true;

  // 198.18.0.0/15 (Benchmark testing)
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4 (Multicast)
  if (parts[0] >= 224 && parts[0] <= 239) return true;

  // 240.0.0.0/4 (Reserved for future use / Broadcast)
  if (parts[0] >= 240) return true;

  return false;
}

export async function assertSafeOutboundUrl(
  urlString: string,
  options: { requireHttps?: boolean } = {}
): Promise<URL> {
  const url = new URL(urlString);
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed');
  if (options.requireHttps && url.protocol !== 'https:') {
    throw new Error('HTTPS is required');
  }
  if (!(await validateWebhookUrl(url.toString()))) {
    throw new Error('URL resolves to a restricted network address');
  }
  return url;
}
