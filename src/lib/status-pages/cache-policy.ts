/**
 * Public representations may be shared-cached briefly. The window is deliberately short because a
 * page can become private or redact fields at any time: worst case a previous public response
 * outlives such a change by s-maxage + stale-while-revalidate (60s). Private pages and pages behind
 * an API token are never stored.
 */
export const PUBLIC_STATUS_CACHE_CONTROL =
  'public, max-age=0, s-maxage=30, stale-while-revalidate=30';
export const PRIVATE_STATUS_CACHE_CONTROL = 'private, no-store';

export function statusCacheControl(page: {
  requireAuth?: boolean | null;
  statusApiRequireToken?: boolean | null;
}): string {
  return page.requireAuth || page.statusApiRequireToken
    ? PRIVATE_STATUS_CACHE_CONTROL
    : PUBLIC_STATUS_CACHE_CONTROL;
}

/**
 * cyrb53: a fast 53-bit string hash. The middleware imports this file and runs on the Edge
 * runtime, which has no `node:crypto`, so the validator cannot use createHash.
 */
function cyrb53(input: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Validator derived from the projection revision (not a security boundary), so unchanged pages
 * answer 304 cheaply. Two independent 53-bit hashes keep accidental collisions negligible.
 */
export function statusEtag(parts: Array<string | number | boolean | null | undefined>): string {
  const joined = parts.map(String).join('|');
  return `"${cyrb53(joined, 0).toString(36)}${cyrb53(joined, 1).toString(36)}"`;
}

/** If-None-Match may carry several validators, weak prefixes, or `*`. */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const bare = (value: string) => value.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some(candidate => {
    const value = bare(candidate);
    return value === '*' || value === bare(etag);
  });
}
