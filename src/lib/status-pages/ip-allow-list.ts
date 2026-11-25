/**
 * CIDR allow-list for private status pages. Pure (no node:net) so the validation schema can share
 * it with client bundles. Entries are IPv4/IPv6 addresses or CIDR ranges; a bare address means a
 * single host. An empty list means "no network restriction".
 */
export const MAX_IP_ALLOW_ENTRIES = 50;

function parseV4(s: string): bigint | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = BigInt(0);
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = (n << BigInt(8)) | BigInt(part);
  }
  return n;
}

function parseV6(input: string): bigint | null {
  let s = input;
  const cut = s.lastIndexOf(':') + 1;
  if (s.slice(cut).includes('.')) {
    const v4 = parseV4(s.slice(cut));
    if (v4 === null) return null;
    s = `${s.slice(0, cut)}${(v4 >> BigInt(16)).toString(16)}:${(v4 & BigInt(0xffff)).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groupsOf = (h: string) => (h === '' ? [] : h.split(':'));
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let n = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    n = (n << BigInt(16)) | BigInt(`0x${group}`);
  }
  return n;
}

type ParsedIp = { family: 4 | 6; value: bigint };

function parseIp(raw: string): ParsedIp | null {
  const s = raw.trim().replace(/^\[|\]$/g, '');
  if (s.includes(':')) {
    const value = parseV6(s);
    if (value === null) return null;
    // IPv4-mapped (::ffff:a.b.c.d) is the same host as the IPv4 address.
    if (value >> BigInt(32) === BigInt(0xffff)) return { family: 4, value: value & BigInt(0xffffffff) };
    return { family: 6, value };
  }
  const value = parseV4(s);
  return value === null ? null : { family: 4, value };
}

export function parseIpAllowEntry(
  entry: string
): { family: 4 | 6; base: bigint; prefix: number } | null {
  const [addr, bits, ...rest] = entry.trim().split('/');
  if (rest.length > 0) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.family === 4 ? 32 : 128;
  // A mapped IPv4 range written as IPv6 loses 96 bits of prefix when folded to IPv4.
  const mapped = ip.family === 4 && addr.includes(':');
  let prefix = max;
  if (bits !== undefined) {
    if (!/^\d{1,3}$/.test(bits)) return null;
    prefix = Number(bits) - (mapped ? 96 : 0);
    if (prefix < 0 || prefix > max) return null;
  }
  return { family: ip.family, base: ip.value, prefix };
}

export function isValidIpAllowEntry(entry: string): boolean {
  return parseIpAllowEntry(entry) !== null;
}

/** Trim, drop blanks and duplicates, keep order. Throws nothing; validity is checked separately. */
export function normalizeIpAllowList(entries: readonly string[]): string[] {
  return [...new Set(entries.map(entry => entry.trim()).filter(Boolean))];
}

export function isIpAllowed(ip: string | null | undefined, list: readonly string[]): boolean {
  if (list.length === 0) return true;
  const client = ip ? parseIp(ip) : null;
  // Fail closed: an unidentifiable client cannot satisfy a restriction.
  if (!client) return false;
  const max = client.family === 4 ? BigInt(32) : BigInt(128);
  return list.some(entry => {
    const rule = parseIpAllowEntry(entry);
    if (!rule || rule.family !== client.family) return false;
    const shift = max - BigInt(rule.prefix);
    return client.value >> shift === rule.base >> shift;
  });
}
