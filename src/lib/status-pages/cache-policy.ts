import { createHash } from 'node:crypto';

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

/** Strong validator derived from the projection revision, so unchanged pages answer 304 cheaply. */
export function statusEtag(parts: Array<string | number | boolean | null | undefined>): string {
  return `"${createHash('sha256').update(parts.map(String).join('|')).digest('base64url').slice(0, 27)}"`;
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
