import { getOpsKnightProcessRole, isDedicatedHttpRole } from './runtime-role';

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

/**
 * Route for the pre-paging noise-control lookup pool. Its per-connection statement timeout is a startup
 * option, which transaction poolers may discard, so like MCP it prefers the direct route.
 */
export function selectPrePagingLookupDatasourceUrl(
  env: { DIRECT_DATABASE_URL?: string; DATABASE_URL?: string } = {
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  }
): string | undefined {
  return env.DIRECT_DATABASE_URL ?? env.DATABASE_URL;
}

/** The role-specific pool size setting for this process, when one is set. */
export function rolePoolSize(): string | undefined {
  switch (getOpsKnightProcessRole()) {
    case 'integrated':
      return process.env.DATABASE_POOL_SIZE_INTEGRATED;
    case 'web':
    case 'http':
      return process.env.DATABASE_POOL_SIZE_WEB;
    case 'scheduler':
      return process.env.DATABASE_POOL_SIZE_SCHEDULER;
    case 'worker':
      return process.env.DATABASE_POOL_SIZE_WORKER;
    case 'general-worker':
      return process.env.DATABASE_POOL_SIZE_GENERAL_WORKER;
    case 'critical-worker':
      return process.env.DATABASE_POOL_SIZE_CRITICAL_WORKER;
    case 'bulk-worker':
      return process.env.DATABASE_POOL_SIZE_BULK_WORKER;
    case 'status-projector':
      return process.env.DATABASE_POOL_SIZE_STATUS_PROJECTOR;
    case 'runbook-worker':
      return process.env.DATABASE_POOL_SIZE_RUNBOOK_WORKER;
    case 'ingestion-worker':
      return process.env.DATABASE_POOL_SIZE_INGESTION_WORKER;
    case 'intelligence-worker':
      return process.env.DATABASE_POOL_SIZE_INTELLIGENCE_WORKER;
  }
}

/** The connection limit the primary Prisma client is configured with in this process. */
export function primaryPoolSize(): number {
  const configured = configurePrismaDatasource(
    selectPrismaDatasourceUrl(getOpsKnightProcessRole()),
    rolePoolSize() ?? process.env.DATABASE_POOL_SIZE
  );
  try {
    return poolSize(new URL(configured ?? '').searchParams.get('connection_limit') ?? undefined);
  } catch {
    return DEFAULT_POOL_SIZE;
  }
}

/**
 * Pre-paging lookup connections per process: `PREPAGING_LOOKUP_POOL_SIZE` (1-32) when valid, otherwise a
 * quarter of the main pool, 2-8. An event holds one lookup connection for about a millisecond and no more
 * events can be in the hook than the main pool has connections. Measured at concurrency 16, fail-open came
 * from cold connections and per-query client overhead, not from waiting for one: 16 connections failed
 * open more often than 2-5, because each new connection is cold. See docs/architecture/intelligence.md.
 */
export function prePagingLookupPoolSize(
  mainPoolSize: number,
  configured: string | undefined = process.env.PREPAGING_LOOKUP_POOL_SIZE
): number {
  const explicit = Number(configured);
  if (configured?.trim() && Number.isInteger(explicit) && explicit >= 1 && explicit <= 32)
    return explicit;
  return Math.min(8, Math.max(2, Math.ceil(mainPoolSize / 4)));
}
