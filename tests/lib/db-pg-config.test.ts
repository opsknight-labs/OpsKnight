import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseUrlError, defaultPoolSize, planPgConnection } from '@/lib/db/pg-config';
import { configurePrismaDatasource } from '@/lib/prisma-datasource';

const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsknight-pg-config-'));
fs.writeFileSync(path.join(certDir, 'ca.crt'), 'CA');
fs.writeFileSync(path.join(certDir, 'client.crt'), 'CERT');
fs.writeFileSync(path.join(certDir, 'client.key'), 'KEY');
afterAll(() => fs.rmSync(certDir, { recursive: true, force: true }));

const plan = (url: string) => planPgConnection(url, { certificateBaseDir: certDir });

describe('database URL translation to node-postgres', () => {
  it('maps credentials, host, port and database with percent-decoding', () => {
    const { pool, target } = plan(
      'postgresql://ops%40knight:p%40ss%3Aw%2Frd@db.internal:6543/ops%20db'
    );
    expect(pool).toMatchObject({
      host: 'db.internal',
      port: 6543,
      user: 'ops@knight',
      password: 'p@ss:w/rd',
      database: 'ops db',
    });
    expect(target).toBe('db.internal:6543');
  });

  it('keeps Prisma 5 pool defaults when the URL has no pool parameters', () => {
    const { pool } = plan('postgresql://u:p@db/app');
    expect(pool.max).toBe(defaultPoolSize());
    expect(pool.connectionTimeoutMillis).toBe(10_000);
    expect(pool.idleTimeoutMillis).toBe(300_000);
    expect(pool.maxLifetimeSeconds).toBe(0);
    expect(pool.keepAlive).toBe(true);
  });

  it('maps every Prisma pool parameter', () => {
    const { pool, warnings } = plan(
      'postgresql://u:p@db/app?connection_limit=7&pool_timeout=30&connect_timeout=3' +
        '&max_idle_connection_lifetime=60&max_connection_lifetime=900&socket_timeout=12' +
        '&statement_cache_size=100&pgbouncer=true'
    );
    expect(pool).toMatchObject({
      max: 7,
      connectionTimeoutMillis: 30_000,
      idleTimeoutMillis: 60_000,
      maxLifetimeSeconds: 900,
      query_timeout: 12_000,
    });
    expect(warnings).toEqual([]);
  });

  it('keeps pool_timeout (pool wait) and connect_timeout (one connection) independent', () => {
    const defaults = plan('postgresql://u:p@db/app');
    expect(defaults.pool.connectionTimeoutMillis).toBe(10_000);
    expect(defaults.connectTimeoutMillis).toBe(5_000);
    // MCP sheds after 1 s in the pool even though opening a connection may take 3 s.
    const mcp = plan('postgresql://u:p@db/app?pool_timeout=1&connect_timeout=3');
    expect(mcp.pool.connectionTimeoutMillis).toBe(1_000);
    expect(mcp.connectTimeoutMillis).toBe(3_000);
  });

  it('treats a zero timeout as unbounded, as Prisma did', () => {
    expect(plan('postgresql://u:p@db/app?pool_timeout=0').pool.connectionTimeoutMillis).toBe(0);
    expect(plan('postgresql://u:p@db/app?connect_timeout=0').connectTimeoutMillis).toBe(0);
  });

  it('rejects malformed pool parameters instead of silently using defaults', () => {
    expect(() => plan('postgresql://u:p@db/app?connection_limit=0')).toThrow(DatabaseUrlError);
    expect(() => plan('postgresql://u:p@db/app?connection_limit=abc')).toThrow(DatabaseUrlError);
    expect(() => plan('postgresql://u:p@db/app?pool_timeout=-1')).toThrow(DatabaseUrlError);
  });

  it('honours the OpsKnight role pool configuration end to end', () => {
    const configured = configurePrismaDatasource(
      'postgresql://u:p@db/app?connection_limit=40&pool_timeout=30',
      '4'
    )!;
    const { pool } = plan(configured);
    expect(pool.max).toBe(4);
    expect(pool.connectionTimeoutMillis).toBe(30_000);
    expect(pool.options).toBe('-c statement_timeout=30000 -c jit=off -c TimeZone=UTC');
  });

  it('forces a UTC session unless the operator chose a time zone', () => {
    expect(plan('postgresql://u:p@db/app').pool.options).toBe('-c TimeZone=UTC');
    expect(
      plan('postgresql://u:p@db/app?options=-c%20TimeZone%3DEurope%2FBerlin').pool.options
    ).toBe('-c TimeZone=Europe/Berlin');
  });

  it('applies the schema parameter to model queries and the raw-SQL search_path', () => {
    const result = plan('postgresql://u:p@db/app?schema=opsknight');
    expect(result.schema).toBe('opsknight');
    expect(result.pool.options).toBe('-c search_path="opsknight" -c TimeZone=UTC');
    expect(() => plan('postgresql://u:p@db/app?schema=bad%3Bdrop')).toThrow(DatabaseUrlError);
  });

  it('supports Unix-domain sockets through the host parameter without TLS', () => {
    const result = plan('postgresql://u:p@localhost/app?host=/cloudsql/project:region:db');
    expect(result.pool.host).toBe('/cloudsql/project:region:db');
    expect(result.tls).toMatchObject({ mode: 'disable', socket: true, options: undefined });
  });

  it('sets application_name unless the URL or its options already choose one', () => {
    const named = (url: string) =>
      planPgConnection(url, { applicationName: 'opsknight-web' }).pool.application_name;
    expect(named('postgresql://u:p@db/app')).toBe('opsknight-web');
    expect(named('postgresql://u:p@db/app?application_name=custom')).toBe('custom');
    expect(
      named('postgresql://u:p@db/app?options=-c%20application_name%3Dopsknight-mcp')
    ).toBeUndefined();
  });

  it('warns about unknown parameters without echoing their values', () => {
    const { warnings } = plan('postgresql://u:p@db/app?mystery=secret-value&other=1');
    expect(warnings).toEqual(['Ignoring unsupported database URL parameters: mystery, other.']);
    expect(warnings.join(' ')).not.toContain('secret-value');
  });

  it('never includes credentials in diagnostics', () => {
    const result = plan('postgresql://user:super-secret@db.example.com/app?sslmode=require');
    expect(JSON.stringify({ warnings: result.warnings, target: result.target })).not.toContain(
      'super-secret'
    );
  });

  it('rejects Accelerate and non-PostgreSQL URLs', () => {
    expect(() => plan('prisma://accelerate.prisma-data.net/?api_key=x')).toThrow(/Accelerate/);
    expect(() => plan('mysql://u:p@db/app')).toThrow(DatabaseUrlError);
    expect(() => plan('not a url')).toThrow(DatabaseUrlError);
  });
});

describe('libpq sslmode semantics', () => {
  it('defaults to prefer, which encrypts when available without verification', () => {
    const { tls } = plan('postgresql://u:p@db.example.com/app');
    expect(tls.mode).toBe('prefer');
    expect(tls.options).toMatchObject({ rejectUnauthorized: false, servername: 'db.example.com' });
    expect(tls.verifiesCertificate).toBe(false);
  });

  it('disable never uses TLS', () => {
    expect(plan('postgresql://u:p@db/app?sslmode=disable').tls).toMatchObject({
      mode: 'disable',
      options: undefined,
    });
  });

  it('require encrypts without verification and warns for remote hosts', () => {
    const remote = plan('postgresql://u:p@db.example.com/app?sslmode=require');
    expect(remote.tls).toMatchObject({ mode: 'require', verifiesCertificate: false });
    expect(remote.tls.options?.rejectUnauthorized).toBe(false);
    expect(remote.warnings.join(' ')).toMatch(/not verified/);
    expect(plan('postgresql://u:p@127.0.0.1/app?sslmode=require').warnings).toEqual([]);
  });

  it('require with a root certificate verifies the chain like libpq verify-ca', () => {
    const { tls } = plan('postgresql://u:p@db.example.com/app?sslmode=require&sslrootcert=ca.crt');
    expect(tls.mode).toBe('verify-ca');
    expect(tls.options?.rejectUnauthorized).toBe(true);
    expect(tls.options?.ca?.toString()).toBe('CA');
    expect(tls.options?.checkServerIdentity?.('db.example.com', {} as never)).toBeUndefined();
  });

  it('verify-full checks chain and host name, with the system store when no root is given', () => {
    const withRoot = plan(
      `postgresql://u:p@db.example.com/app?sslmode=verify-full&sslrootcert=${path.join(certDir, 'ca.crt')}`
    );
    expect(withRoot.tls).toMatchObject({ mode: 'verify-full', verifiesCertificate: true });
    expect(withRoot.tls.options?.checkServerIdentity).toBeUndefined();
    expect(withRoot.tls.options?.ca?.toString()).toBe('CA');
    const system = plan('postgresql://u:p@db.example.com/app?sslmode=verify-full');
    expect(system.tls.options?.ca).toBeUndefined();
    expect(
      plan('postgresql://u:p@db/app?sslmode=verify-full&sslrootcert=system').tls.options?.ca
    ).toBeUndefined();
  });

  it('maps Prisma sslaccept=strict to full verification', () => {
    expect(plan('postgresql://u:p@db/app?sslmode=require&sslaccept=strict').tls.mode).toBe(
      'verify-full'
    );
    expect(plan('postgresql://u:p@db/app?sslaccept=strict').tls.mode).toBe('verify-full');
    const ignored = plan(
      'postgresql://u:p@db/app?sslmode=verify-full&sslaccept=accept_invalid_certs'
    );
    expect(ignored.tls.mode).toBe('verify-full');
    expect(ignored.warnings.join(' ')).toMatch(/ignored/);
  });

  it('loads client certificates and identities relative to the prisma directory', () => {
    const { tls } = plan(
      'postgresql://u:p@db/app?sslmode=verify-full&sslrootcert=ca.crt&sslcert=client.crt&sslkey=client.key'
    );
    expect(tls.options?.cert?.toString()).toBe('CERT');
    expect(tls.options?.key?.toString()).toBe('KEY');
  });

  it('fails closed for unreadable certificates and unknown modes', () => {
    expect(() =>
      plan('postgresql://u:p@db/app?sslmode=verify-full&sslrootcert=missing.crt')
    ).toThrow(/sslrootcert/);
    expect(() => plan('postgresql://u:p@db/app?sslmode=bogus')).toThrow(/Unsupported sslmode/);
    expect(() => plan('postgresql://u:p@db/app?sslaccept=maybe')).toThrow(DatabaseUrlError);
  });

  it('accepts the node-postgres no-verify spelling as require', () => {
    expect(plan('postgresql://u:p@db/app?sslmode=no-verify').tls.mode).toBe('require');
  });

  it('does not send SNI for IP literals', () => {
    expect(
      plan('postgresql://u:p@10.0.0.5/app?sslmode=require').tls.options?.servername
    ).toBeUndefined();
    expect(plan('postgresql://u:p@[::1]:5432/app?sslmode=require').pool.host).toBe('::1');
  });
});
