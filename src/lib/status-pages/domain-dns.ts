import { isIP } from 'node:net';

export type DomainDnsState = 'verified' | 'pending' | 'mismatch';

export interface DomainDnsResult {
  state: DomainDnsState;
  /** The record the admin should create. */
  expected: { type: 'CNAME'; host: string; value: string };
  found: { cname: string[]; addresses: string[] };
  message: string;
}

const normHost = (value: string) => value.trim().toLowerCase().replace(/\.$/, '');

/** Only plausible public DNS names: no IP literals, single labels or internal-only suffixes. */
export function isCheckableHostname(value: string): boolean {
  const host = normHost(value);
  if (host.length < 4 || host.length > 253 || isIP(host)) return false;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host))
    return false;
  return !/\.(local|localhost|internal|lan|home|corp|test|invalid|example)$/.test(host);
}

/**
 * Map raw DNS answers to a verdict. A CNAME to the app host, or address records that overlap the
 * app host's own addresses (apex domains cannot CNAME), count as verified.
 */
export function mapDomainDnsResult(input: {
  domain: string;
  appHost: string;
  cname: readonly string[];
  addresses: readonly string[];
  appAddresses: readonly string[];
}): DomainDnsResult {
  const appHost = normHost(input.appHost);
  const cname = input.cname.map(normHost);
  const addresses = [...new Set(input.addresses.map(a => a.toLowerCase()))];
  const base = {
    expected: { type: 'CNAME' as const, host: normHost(input.domain), value: appHost },
    found: { cname, addresses },
  };
  if (cname.includes(appHost))
    return { ...base, state: 'verified', message: 'CNAME points to this workspace.' };
  const app = new Set(input.appAddresses.map(a => a.toLowerCase()));
  if (addresses.some(a => app.has(a)))
    return { ...base, state: 'verified', message: 'Address records resolve to this workspace.' };
  if (cname.length === 0 && addresses.length === 0)
    return {
      ...base,
      state: 'pending',
      message: 'No DNS records found yet. Records can take time to propagate.',
    };
  return {
    ...base,
    state: 'mismatch',
    message: cname.length
      ? `CNAME points to ${cname[0]} instead of ${appHost}.`
      : 'Address records do not match this workspace. Use the CNAME below instead.',
  };
}
