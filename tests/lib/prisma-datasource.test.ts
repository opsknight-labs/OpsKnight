import { describe, expect, it } from 'vitest';
import { configurePrismaDatasource } from '@/lib/prisma-datasource';

describe('Prisma datasource pool safety', () => {
  it('uses the safe default of ten connections', () => {
    const url = new URL(configurePrismaDatasource('postgresql://db/app', undefined)!);
    expect(url.searchParams.get('connection_limit')).toBe('10');
  });

  it('uses a valid configured pool size', () => {
    const url = new URL(configurePrismaDatasource('postgresql://db/app', '5')!);
    expect(url.searchParams.get('connection_limit')).toBe('5');
  });

  it('preserves explicit URL parameters without duplicates', () => {
    const configured = configurePrismaDatasource(
      'postgresql://db/app?connection_limit=7&pool_timeout=30&statement_cache_size=20',
      '5'
    )!;
    const url = new URL(configured);
    expect(url.searchParams.getAll('connection_limit')).toEqual(['7']);
    expect(url.searchParams.getAll('pool_timeout')).toEqual(['30']);
    expect(url.searchParams.getAll('statement_cache_size')).toEqual(['20']);
  });

  it('falls back safely for invalid configured sizes', () => {
    const url = new URL(configurePrismaDatasource('postgresql://db/app', '10000')!);
    expect(url.searchParams.get('connection_limit')).toBe('10');
  });
});
