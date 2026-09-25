import { describe, expect, it } from 'vitest';
import { configurePrismaDatasource, selectPrismaDatasourceUrl } from '@/lib/prisma-datasource';

describe('Prisma datasource pool safety', () => {
  it('uses the optional pooled endpoint only for web processes', () => {
    const env = {
      DATABASE_URL: 'postgresql://direct/app',
      WEB_DATABASE_URL: 'postgresql://pool/app',
    };
    expect(selectPrismaDatasourceUrl('web', env)).toBe('postgresql://pool/app');
    expect(selectPrismaDatasourceUrl('critical-worker', env)).toBe('postgresql://direct/app');
    expect(selectPrismaDatasourceUrl('web', { DATABASE_URL: env.DATABASE_URL })).toBe(
      'postgresql://direct/app'
    );
  });
  it('uses the safe default of ten connections', () => {
    const url = new URL(configurePrismaDatasource('postgresql://db/app', undefined)!);
    expect(url.searchParams.get('connection_limit')).toBe('10');
    expect(url.searchParams.get('options')).toBe('-c statement_timeout=30000');
  });

  it('uses a valid configured pool size', () => {
    const url = new URL(configurePrismaDatasource('postgresql://db/app', '5')!);
    expect(url.searchParams.get('connection_limit')).toBe('5');
  });

  it('lets an explicit role pool override the shared URL connection limit', () => {
    const configured = configurePrismaDatasource(
      'postgresql://db/app?connection_limit=7&pool_timeout=30&statement_cache_size=20&options=-c%20statement_timeout%3D60000',
      '5'
    )!;
    const url = new URL(configured);
    expect(url.searchParams.getAll('connection_limit')).toEqual(['5']);
    expect(url.searchParams.getAll('pool_timeout')).toEqual(['30']);
    expect(url.searchParams.getAll('statement_cache_size')).toEqual(['20']);
    expect(url.searchParams.getAll('options')).toEqual(['-c statement_timeout=60000']);
  });

  it('preserves a URL connection limit when no role pool is configured', () => {
    const url = new URL(
      configurePrismaDatasource('postgresql://db/app?connection_limit=7', undefined)!
    );
    expect(url.searchParams.getAll('connection_limit')).toEqual(['7']);
  });

  it('falls back safely for invalid configured sizes', () => {
    const url = new URL(configurePrismaDatasource('postgresql://db/app', '10000')!);
    expect(url.searchParams.get('connection_limit')).toBe('10');
  });
});
