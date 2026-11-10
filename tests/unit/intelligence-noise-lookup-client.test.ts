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
import { selectPrePagingLookupDatasourceUrl } from '@/lib/prisma-datasource';

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
});
