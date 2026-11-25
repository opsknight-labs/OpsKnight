import { describe, expect, it } from 'vitest';
import {
  PRIVATE_STATUS_CACHE_CONTROL,
  PUBLIC_STATUS_CACHE_CONTROL,
  etagMatches,
  statusCacheControl,
  statusEtag,
} from '@/lib/status-pages/cache-policy';

describe('status-page cache policy', () => {
  it('lets shared caches hold public representations only briefly', () => {
    expect(PUBLIC_STATUS_CACHE_CONTROL).toContain('s-maxage=30');
    expect(PUBLIC_STATUS_CACHE_CONTROL).toContain('stale-while-revalidate=30');
    expect(PUBLIC_STATUS_CACHE_CONTROL).not.toContain('must-revalidate');
  });

  it('never stores authenticated or token-gated representations', () => {
    expect(PRIVATE_STATUS_CACHE_CONTROL).toBe('private, no-store');
    expect(statusCacheControl({ requireAuth: true })).toBe(PRIVATE_STATUS_CACHE_CONTROL);
    expect(statusCacheControl({ statusApiRequireToken: true })).toBe(PRIVATE_STATUS_CACHE_CONTROL);
    expect(statusCacheControl({})).toBe(PUBLIC_STATUS_CACHE_CONTROL);
  });

  it('derives a stable revision-based ETag', () => {
    expect(statusEtag(['p', 'r1', false])).toBe(statusEtag(['p', 'r1', false]));
    expect(statusEtag(['p', 'r1', false])).not.toBe(statusEtag(['p', 'r2', false]));
    expect(statusEtag(['p', 'r1', false])).not.toBe(statusEtag(['p', 'r1', true]));
  });

  it('matches If-None-Match lists, weak validators and wildcards', () => {
    const tag = statusEtag(['p', 'r1']);
    expect(etagMatches(tag, tag)).toBe(true);
    expect(etagMatches(`"other", W/${tag}`, tag)).toBe(true);
    expect(etagMatches('*', tag)).toBe(true);
    expect(etagMatches('"other"', tag)).toBe(false);
    expect(etagMatches(null, tag)).toBe(false);
  });
});
