import { isDedicatedHttpRole } from './runtime-role';

const DEFAULT_POOL_SIZE = 10;

export function selectMcpPrismaDatasourceUrl(
  env = {
    MCP_DATABASE_URL: process.env.MCP_DATABASE_URL,
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  }
): string | undefined {
  // Transaction poolers may discard per-connection startup settings. Keep the
  // bounded MCP pool on the direct route until that topology is certified.
  return env.MCP_DATABASE_URL ?? env.DIRECT_DATABASE_URL ?? env.DATABASE_URL;
}

/** MCP has an independent small pool even in the integrated web process. */
export function configureMcpPrismaDatasource(rawUrl: string | undefined, size?: string): string {
  if (size !== undefined && !/^\d+$/.test(size.trim())) {
    throw new Error('MCP_DATABASE_POOL_SIZE must be an integer between 1 and 4');
  }
  const limit = size === undefined ? 2 : Number(size);
  if (!Number.isInteger(limit) || limit < 1 || limit > 4) {
    throw new Error('MCP_DATABASE_POOL_SIZE must be an integer between 1 and 4');
  }
  if (!rawUrl) throw new Error('MCP database URL is required');
  const url = new URL(rawUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('MCP requires a PostgreSQL datasource');
  }
  if (url.searchParams.has('pgbouncer') && url.searchParams.get('pgbouncer') !== 'false') {
    throw new Error('MCP requires a direct PostgreSQL route for SQL budget enforcement');
  }
  url.searchParams.set('connection_limit', String(limit));
  url.searchParams.set('pool_timeout', '1');
  url.searchParams.set('connect_timeout', '3');
  url.searchParams.set('statement_cache_size', '100');
  // Override inherited options: a shared URL must not relax MCP's SQL budget.
  url.searchParams.set(
    'options',
    '-c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000 -c application_name=opsknight-mcp'
  );
  return url.toString();
}

export function selectPrismaDatasourceUrl(
  role: string,
  env: { DATABASE_URL?: string; WEB_DATABASE_URL?: string } = {
    DATABASE_URL: process.env.DATABASE_URL,
    WEB_DATABASE_URL: process.env.WEB_DATABASE_URL,
  }
): string | undefined {
  return isDedicatedHttpRole(role) ? (env.WEB_DATABASE_URL ?? env.DATABASE_URL) : env.DATABASE_URL;
}

function poolSize(value: string | undefined): number {
  if (!value) return DEFAULT_POOL_SIZE;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : DEFAULT_POOL_SIZE;
}

export function configurePrismaDatasource(
  rawUrl: string | undefined,
  configuredPoolSize: string | undefined,
  transactionPooler = false
): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    if (configuredPoolSize?.trim()) {
      // A role-specific pool setting is an explicit deployment override. This
      // lets all roles share one DATABASE_URL even when that URL contains a
      // legacy connection_limit value.
      url.searchParams.set('connection_limit', String(poolSize(configuredPoolSize)));
    } else if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(poolSize(configuredPoolSize)));
    }
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '10');
    if (!url.searchParams.has('statement_cache_size')) {
      url.searchParams.set('statement_cache_size', '100');
    }
    if (!url.searchParams.has('options')) {
      // OLTP workers use short indexed statements; compiling each claim can
      // cost more than execution. Preserve explicit operator options verbatim.
      const pooled = transactionPooler || url.searchParams.get('pgbouncer') === 'true';
      url.searchParams.set(
        'options',
        pooled ? '-c statement_timeout=30000' : '-c statement_timeout=30000 -c jit=off'
      );
    }
    return url.toString();
  } catch {
    // Preserve provider-specific Prisma URLs that the WHATWG parser does not
    // understand. Prisma will surface any genuine configuration error.
    return rawUrl;
  }
}
