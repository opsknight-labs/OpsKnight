import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getNoiseLookupClient,
  lookupTimeoutMs,
  noiseLookupDatasourceUrl,
  prePagingDeadlineMs,
  setNoiseLookupRoute,
  setPrePagingDeadlineMs,
} from '@/lib/intelligence/noise-controls/lookup-client';
import {
  prePagingLookupPoolSize,
  primaryPoolSize,
  selectPrePagingLookupDatasourceUrl,
} from '@/lib/prisma-datasource';

/** The dedicated pre-paging lookup pool: its route, size and deadline-sized server-side timeouts. */

afterEach(() => {
  setPrePagingDeadlineMs(null);
  setNoiseLookupRoute(null);
});

describe('noise-control lookup pool', () => {
  it('prefers the direct route, like the MCP pool', () => {
    expect(
      selectPrePagingLookupDatasourceUrl({
        DIRECT_DATABASE_URL: 'postgresql://direct/app',
        DATABASE_URL: 'postgresql://pooled/app',
      })
    ).toBe('postgresql://direct/app');
    expect(selectPrePagingLookupDatasourceUrl({ DATABASE_URL: 'postgresql://pooled/app' })).toBe(
      'postgresql://pooled/app'
    );
  });

  it('the transaction route opens no pool', () => {
    setNoiseLookupRoute('transaction');
    expect(getNoiseLookupClient(5)).toBeNull();
  });

  it('sets the server-side statement and lock timeouts to the deadline, overriding inherited options', () => {
    const url = new URL(
      noiseLookupDatasourceUrl(
        'postgresql://u:p@db:5432/app?connection_limit=40&pool_timeout=30&options=-c%20statement_timeout%3D600000',
        5,
        2
      )!
    );
    expect(url.searchParams.get('connection_limit')).toBe('2');
    expect(url.searchParams.get('pool_timeout')).toBe('1');
    expect(url.searchParams.get('connect_timeout')).toBe('3');
    const options = url.searchParams.get('options')!;
    expect(options).toContain('-c statement_timeout=5 ');
    expect(options).toContain('-c lock_timeout=5 ');
    expect(options).not.toContain('600000');
  });

  it('has no datasource for a missing, non-PostgreSQL or transaction-pooled URL (the caller uses the transaction)', () => {
    expect(noiseLookupDatasourceUrl(undefined, 5, 2)).toBeNull();
    expect(noiseLookupDatasourceUrl('mysql://u:p@db/app', 5, 2)).toBeNull();
    expect(noiseLookupDatasourceUrl('postgresql://u:p@db/app?pgbouncer=true', 5, 2)).toBeNull();
  });

  it('shares the deadline override with the hook and rounds it to whole milliseconds', () => {
    expect(prePagingDeadlineMs()).toBe(5);
    setPrePagingDeadlineMs(500);
    expect(prePagingDeadlineMs()).toBe(50);
    setPrePagingDeadlineMs(0);
    expect(prePagingDeadlineMs()).toBe(1);
    expect(lookupTimeoutMs(4.2)).toBe(5);
    expect(lookupTimeoutMs(0)).toBe(1);
  });

  it('sizes the pool from the main pool unless PREPAGING_LOOKUP_POOL_SIZE says otherwise', () => {
    // A quarter of the main pool, 2-8: the default pool of 10 gets 3.
    expect(prePagingLookupPoolSize(10, undefined)).toBe(3);
    expect(prePagingLookupPoolSize(1, undefined)).toBe(2);
    expect(prePagingLookupPoolSize(100, undefined)).toBe(8);
    expect(prePagingLookupPoolSize(10, '12')).toBe(12);
    // An invalid override falls back to the derived size rather than failing ingestion.
    for (const bad of ['0', '33', '2.5', 'many', ' '])
      expect(prePagingLookupPoolSize(10, bad)).toBe(3);
  });

  it('reads the main pool size the primary client is configured with', () => {
    const env = { ...process.env };
    try {
      delete process.env.DATABASE_POOL_SIZE;
      process.env.DATABASE_URL = 'postgresql://u:p@db/app?connection_limit=24';
      expect(primaryPoolSize()).toBe(24);
      process.env.DATABASE_POOL_SIZE = '6';
      expect(primaryPoolSize()).toBe(6);
      process.env.DATABASE_URL = 'postgresql://u:p@db/app';
      delete process.env.DATABASE_POOL_SIZE;
      expect(primaryPoolSize()).toBe(10);
    } finally {
      process.env = env;
    }
  });
});
