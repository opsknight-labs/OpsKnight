import { describe, expect, it } from 'vitest';
import {
  configurePrismaDatasource,
  configureMcpPrismaDatasource,
  selectMcpPrismaDatasourceUrl,
  selectPrismaDatasourceUrl,
} from '@/lib/prisma-datasource';

describe('Prisma datasource pool safety', () => {
  it('prefers a dedicated MCP role or the direct route over the shared web pooler', () => {
    const env = {
      MCP_DATABASE_URL: 'postgresql://mcp-role/db',
      DIRECT_DATABASE_URL: 'postgresql://direct/db',
      DATABASE_URL: 'postgresql://legacy/db',
    };
    expect(selectMcpPrismaDatasourceUrl(env)).toBe(env.MCP_DATABASE_URL);
    expect(selectMcpPrismaDatasourceUrl({ ...env, MCP_DATABASE_URL: undefined })).toBe(
      env.DIRECT_DATABASE_URL
    );
    expect(
      selectMcpPrismaDatasourceUrl({
        ...env,
        MCP_DATABASE_URL: undefined,
        DIRECT_DATABASE_URL: undefined,
      })
    ).toBe(env.DATABASE_URL);
  });
  it('cannot inherit relaxed MCP pool, query or lock budgets from a shared URL', () => {
    const url = new URL(
      configureMcpPrismaDatasource(
        'postgresql://db/app?connection_limit=100&pool_timeout=60&options=-c%20statement_timeout%3D0&sslmode=require'
      )
    );
    expect(url.searchParams.get('connection_limit')).toBe('2');
    expect(url.searchParams.get('pool_timeout')).toBe('1');
    expect(url.searchParams.get('connect_timeout')).toBe('3');
    expect(url.searchParams.get('options')).toContain('statement_timeout=5000');
    expect(url.searchParams.get('options')).toContain('lock_timeout=1000');
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(
      new URL(configureMcpPrismaDatasource('postgresql://db/app', '4')).searchParams.get(
        'connection_limit'
      )
    ).toBe('4');
  });
  it('fails closed on unsupported MCP pool configuration', () => {
    for (const size of ['0', '5', '100', '-1', '1.5', 'NaN', '']) {
      expect(() => configureMcpPrismaDatasource('postgresql://db/app', size)).toThrow();
    }
    expect(() => configureMcpPrismaDatasource(undefined)).toThrow();
    expect(() => configureMcpPrismaDatasource('https://db/app')).toThrow();
    expect(() => configureMcpPrismaDatasource('postgresql://db/app?pgbouncer=true')).toThrow();
  });
  it('uses the optional pooled endpoint only for web processes', () => {
    const env = {
      DATABASE_URL: 'postgresql://direct/app',
      WEB_DATABASE_URL: 'postgresql://pool/app',
    };
    expect(selectPrismaDatasourceUrl('web', env)).toBe('postgresql://pool/app');
    expect(selectPrismaDatasourceUrl('http', env)).toBe('postgresql://pool/app');
    expect(selectPrismaDatasourceUrl('critical-worker', env)).toBe('postgresql://direct/app');
    expect(selectPrismaDatasourceUrl('web', { DATABASE_URL: env.DATABASE_URL })).toBe(
      'postgresql://direct/app'
    );
  });
  it('uses the safe default of ten connections', () => {
    const url = new URL(configurePrismaDatasource('postgresql://db/app', undefined)!);
    expect(url.searchParams.get('connection_limit')).toBe('10');
    expect(url.searchParams.get('options')).toBe('-c statement_timeout=30000 -c jit=off');
  });

  it('preserves PgBouncer startup compatibility in both supported pooler modes', () => {
    const explicit = new URL(configurePrismaDatasource('postgresql://pool/app', '5', true)!);
    const compatibility = new URL(
      configurePrismaDatasource('postgresql://pool/app?pgbouncer=true', '5')!
    );
    expect(explicit.searchParams.get('options')).toBe('-c statement_timeout=30000');
    expect(compatibility.searchParams.get('options')).toBe('-c statement_timeout=30000');
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
