import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { ConnectionOptions } from 'node:tls';
import type { PoolConfig } from 'pg';

/**
 * Translate an OpsKnight/Prisma 5 PostgreSQL connection URL into node-postgres pool settings.
 *
 * Prisma 7 runs queries through `pg`, which ignores Prisma's engine URL parameters
 * (connection_limit, pool_timeout, schema, pgbouncer, ...) and applies different TLS rules.
 * Every existing DATABASE_URL must keep working with the same pool behaviour, so this module
 * is the single place where those parameters are interpreted. It is pure apart from reading
 * certificate files; TLS negotiation for `prefer`/`allow` is resolved by the client factory.
 */

export type SslMode = 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';

export interface PgConnectionPlan {
  /** Pool settings without `ssl`; the factory adds TLS once the mode is resolved. */
  pool: Omit<PoolConfig, 'ssl'>;
  /** Schema used to qualify model queries (Prisma's `schema` parameter). */
  schema: string | undefined;
  tls: TlsPlan;
  /** Non-secret configuration warnings to log once. */
  warnings: string[];
  /** host:port for diagnostics; never includes credentials. */
  target: string;
  /**
   * Prisma connect_timeout: bound on opening one server connection (0 = none). The pool's
   * connectionTimeoutMillis is Prisma pool_timeout: bound on waiting for a pooled connection.
   */
  connectTimeoutMillis: number;
}

export interface TlsPlan {
  mode: SslMode;
  /** TLS options for an encrypted connection; undefined only when TLS is never used. */
  options: ConnectionOptions | undefined;
  verifiesCertificate: boolean;
  /** Unix-domain sockets never negotiate TLS. */
  socket: boolean;
}

export interface PgConnectionOptions {
  /** Default application_name (visible in pg_stat_activity) when the URL does not set one. */
  applicationName?: string;
  /** Directory that relative certificate paths resolve against (Prisma 5: the schema folder). */
  certificateBaseDir?: string;
}

/** Prisma 5 defaults (https://pris.ly/d/connection-pool). */
const DEFAULT_POOL_TIMEOUT_SECONDS = 10;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 5;
const DEFAULT_IDLE_LIFETIME_SECONDS = 300;

const SSL_MODES: readonly SslMode[] = [
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
];

/** URL parameters understood here; any other parameter produces a warning. */
const KNOWN_PARAMS = new Set([
  'connection_limit',
  'pool_timeout',
  'connect_timeout',
  'socket_timeout',
  'max_idle_connection_lifetime',
  'max_connection_lifetime',
  'schema',
  'options',
  'application_name',
  'host',
  'port',
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslidentity',
  'sslpassword',
  'sslaccept',
  // Prisma-engine-only switches with no node-postgres equivalent: unnamed statements are
  // already safe behind transaction poolers and are never cached client-side.
  'pgbouncer',
  'statement_cache_size',
]);

export class DatabaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseUrlError';
  }
}

function nonNegativeSeconds(name: string, value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DatabaseUrlError(`Database URL parameter ${name} must be a non-negative number.`);
  }
  return parsed;
}

function positiveInteger(name: string, value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new DatabaseUrlError(`Database URL parameter ${name} must be a positive integer.`);
  }
  return parsed;
}

/** Prisma 5 default pool size: CPUs * 2 + 1. */
export function defaultPoolSize(): number {
  return os.availableParallelism() * 2 + 1;
}

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

export function isLoopbackDatabaseHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}

function readFile(name: string, file: string, baseDir: string): Buffer {
  const resolved = path.isAbsolute(file) ? file : path.resolve(baseDir, file);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-configured certificate path
    return fs.readFileSync(resolved);
  } catch {
    throw new DatabaseUrlError(`Database URL parameter ${name} points to an unreadable file.`);
  }
}

function resolveSslMode(params: URLSearchParams, warnings: string[]): SslMode {
  const raw = params.get('sslmode')?.trim().toLowerCase() || 'prefer';
  let mode: SslMode;
  if (raw === 'no-verify') {
    // node-postgres spelling of "encrypt without verification".
    mode = 'require';
  } else if ((SSL_MODES as readonly string[]).includes(raw)) {
    mode = raw as SslMode;
  } else {
    throw new DatabaseUrlError(
      `Unsupported sslmode "${raw}". Use one of: ${SSL_MODES.join(', ')}.`
    );
  }

  const accept = params.get('sslaccept')?.trim().toLowerCase();
  if (accept === 'strict') {
    // Prisma's strict acceptance means full certificate and host-name verification.
    if (mode === 'prefer' || mode === 'allow' || mode === 'require') mode = 'verify-full';
  } else if (accept && accept !== 'accept_invalid_certs') {
    throw new DatabaseUrlError('sslaccept must be "strict" or "accept_invalid_certs".');
  } else if (
    accept === 'accept_invalid_certs' &&
    (mode === 'verify-ca' || mode === 'verify-full')
  ) {
    warnings.push(`sslaccept=accept_invalid_certs is ignored because sslmode=${mode} is stricter.`);
  }
  return mode;
}

function buildTls(
  params: URLSearchParams,
  mode: SslMode,
  host: string,
  socket: boolean,
  baseDir: string
): TlsPlan {
  if (mode === 'disable' || socket) {
    return { mode: 'disable', options: undefined, verifiesCertificate: false, socket };
  }
  const rootCert = params.get('sslrootcert');
  // libpq: with a root certificate file, sslmode=require behaves like verify-ca.
  const effective: SslMode = mode === 'require' && rootCert ? 'verify-ca' : mode;
  const verifies = effective === 'verify-ca' || effective === 'verify-full';
  const options: ConnectionOptions = { rejectUnauthorized: verifies };

  // Without sslrootcert (or with libpq's "system"), Node's trust store and NODE_EXTRA_CA_CERTS apply.
  if (verifies && rootCert && rootCert !== 'system') {
    options.ca = readFile('sslrootcert', rootCert, baseDir);
  }
  if (effective === 'verify-ca') {
    // Chain verification only, as libpq: the certificate is not matched to the host name.
    options.checkServerIdentity = () => undefined;
  }
  if (net.isIP(host) === 0) options.servername = host;

  const cert = params.get('sslcert');
  const key = params.get('sslkey');
  if (cert) options.cert = readFile('sslcert', cert, baseDir);
  if (key) options.key = readFile('sslkey', key, baseDir);
  const identity = params.get('sslidentity');
  if (identity) {
    options.pfx = readFile('sslidentity', identity, baseDir);
    const passphrase = params.get('sslpassword');
    if (passphrase) options.passphrase = passphrase;
  }
  return { mode: effective, options, verifiesCertificate: verifies, socket };
}

function hasSetting(options: string | undefined, setting: string): boolean {
  return new RegExp(`(^|\\s)(-c\\s*|--)${setting}=`, 'i').test(options ?? '');
}

function buildStartupOptions(params: URLSearchParams, schema: string | undefined): string {
  const parts: string[] = [];
  const operator = params.get('options')?.trim();
  if (operator) parts.push(operator);
  if (schema && !hasSetting(operator, 'search_path')) {
    // Prisma 5 set search_path to the schema parameter; raw SQL relies on it.
    parts.push(`-c search_path="${schema}"`);
  }
  if (!hasSetting(operator, 'timezone')) {
    // Prisma sends DateTime parameters as UTC wall-clock values without an offset, and raw SQL
    // compares them with NOW() and timestamp columns. A UTC session makes both independent of
    // the server TimeZone. PgBouncer tracks TimeZone per client, so this also holds when pooled.
    parts.push('-c TimeZone=UTC');
  }
  return parts.join(' ');
}

export function planPgConnection(
  rawUrl: string,
  settings: PgConnectionOptions = {}
): PgConnectionPlan {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DatabaseUrlError('DATABASE_URL is not a valid URL.');
  }
  if (url.protocol === 'prisma:' || url.protocol === 'prisma+postgres:') {
    throw new DatabaseUrlError(
      'Prisma Accelerate URLs are not supported; configure a direct PostgreSQL or PgBouncer URL.'
    );
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new DatabaseUrlError('DATABASE_URL must use the postgresql:// scheme.');
  }

  const params = url.searchParams;
  const warnings: string[] = [];
  const unknown = [...new Set(params.keys())].filter(key => !KNOWN_PARAMS.has(key));
  if (unknown.length) {
    warnings.push(`Ignoring unsupported database URL parameters: ${unknown.sort().join(', ')}.`);
  }

  const socketDir = params.get('host');
  const socket = Boolean(socketDir?.startsWith('/'));
  const host = socket ? socketDir! : decodeURIComponent(url.hostname.replace(/^\[|\]$/g, ''));
  if (!host) throw new DatabaseUrlError('DATABASE_URL must include a host.');
  const port = Number(params.get('port') ?? (url.port || 5432));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DatabaseUrlError('DATABASE_URL has an invalid port.');
  }

  const schema = params.get('schema')?.trim() || undefined;
  if (schema && !SAFE_IDENTIFIER.test(schema)) {
    throw new DatabaseUrlError('Database URL parameter schema is not a valid schema name.');
  }

  // Prisma 5 semantics: pool_timeout bounds the wait for a pooled connection (including opening
  // a new one); connect_timeout separately bounds opening a single server connection.
  const poolTimeoutSeconds =
    nonNegativeSeconds('pool_timeout', params.get('pool_timeout')) ?? DEFAULT_POOL_TIMEOUT_SECONDS;
  const connectTimeoutSeconds =
    nonNegativeSeconds('connect_timeout', params.get('connect_timeout')) ??
    DEFAULT_CONNECT_TIMEOUT_SECONDS;
  const idleSeconds =
    nonNegativeSeconds(
      'max_idle_connection_lifetime',
      params.get('max_idle_connection_lifetime')
    ) ?? DEFAULT_IDLE_LIFETIME_SECONDS;
  const lifetimeSeconds = nonNegativeSeconds(
    'max_connection_lifetime',
    params.get('max_connection_lifetime')
  );
  const socketTimeout = nonNegativeSeconds('socket_timeout', params.get('socket_timeout'));

  const pool: Omit<PoolConfig, 'ssl'> = {
    host,
    port,
    user: decodeURIComponent(url.username) || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || undefined,
    max: positiveInteger('connection_limit', params.get('connection_limit')) ?? defaultPoolSize(),
    connectionTimeoutMillis: Math.round(poolTimeoutSeconds * 1000),
    idleTimeoutMillis: Math.round(idleSeconds * 1000),
    maxLifetimeSeconds: lifetimeSeconds ?? 0,
    keepAlive: true,
    options: buildStartupOptions(params, schema),
    // An application_name set through `options` (e.g. the MCP pool) must not be overridden.
    application_name:
      params.get('application_name') ??
      (hasSetting(params.get('options') ?? undefined, 'application_name')
        ? undefined
        : settings.applicationName),
  };
  if (socketTimeout) pool.query_timeout = Math.round(socketTimeout * 1000);

  const mode = resolveSslMode(params, warnings);
  const tls = buildTls(
    params,
    mode,
    host,
    socket,
    settings.certificateBaseDir ?? path.join(process.cwd(), 'prisma')
  );
  const target = socket ? `${host}/.s.PGSQL.${port}` : `${host}:${port}`;
  if (tls.mode === 'require' && !socket && !isLoopbackDatabaseHost(host)) {
    warnings.push(
      `Database TLS to ${target} is encrypted but the server certificate is not verified; ` +
        'use sslmode=verify-full with sslrootcert to prevent impersonation.'
    );
  }
  return {
    pool,
    schema,
    tls,
    warnings,
    target,
    connectTimeoutMillis: Math.round(connectTimeoutSeconds * 1000),
  };
}
