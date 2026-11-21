import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Addresses no model endpoint may ever be: link-local ranges, which include every major cloud's instance
 * metadata service (credentials live there), plus the metadata hostnames clouds publish. This holds even when
 * an administrator has consented to a private-network endpoint such as a local Ollama: consent covers "my
 * own network", never "my cloud credentials".
 */
const METADATA_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.azure.internal',
  'instance-data',
]);

export function isForbiddenAddress(address: string): boolean {
  const value = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(value) === 4) {
    // 169.254.0.0/16 link-local (AWS, GCP, Azure, OpenStack metadata) and Alibaba's 100.100.100.200.
    return value.startsWith('169.254.') || value === '100.100.100.200';
  }
  if (isIP(value) === 6) {
    if (/^fe[89ab][0-9a-f]:/.test(value)) return true; // fe80::/10 link-local
    if (value === 'fd00:ec2::254') return true; // AWS IPv6 metadata
    // IPv4-mapped addresses, in dotted form or as URL parsers normalise them (::ffff:a9fe:a9fe).
    const dotted = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isForbiddenAddress(dotted[1]);
    const hex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      return isForbiddenAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return false;
  }
  return false;
}

/** Rejects a URL whose host is, or resolves to, a forbidden address. Lookup failures are left to the fetch. */
export async function assertNotMetadataEndpoint(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (METADATA_HOSTNAMES.has(host) || isForbiddenAddress(host)) {
    throw new Error('Link-local and cloud metadata addresses are never allowed');
  }
  if (isIP(host)) return;
  let addresses: Array<{ address: string }> = [];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return;
  }
  if (addresses.some(entry => isForbiddenAddress(entry.address))) {
    throw new Error('Link-local and cloud metadata addresses are never allowed');
  }
}
