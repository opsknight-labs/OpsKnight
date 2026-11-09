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

/** Connections the intelligence lane uses on its own when it shares a process with ingestion. */
export const DEFAULT_INTELLIGENCE_LANE_POOL_SIZE = 10;
/** A lane pool always keeps one connection beside a running handler (claims, lease renewal, cancel). */
const MIN_INTELLIGENCE_LANE_POOL_SIZE = 2;
const MAX_INTELLIGENCE_LANE_POOL_SIZE = 16;

/**
 * Size of the intelligence lane's own pool in a shared process (`integrated`, `worker`,
 * `general-worker`). `0` keeps the lane on the process pool, the behaviour before the pool existed.
 * The dedicated `intelligence-worker` role never uses it: the whole process is the lane there.
 * Values that are not an integer between 0 and 16 fall back to the default; 1 is raised to 2.
 */
export function intelligenceLanePoolSize(
  value: string | undefined = process.env.INTELLIGENCE_LANE_DATABASE_POOL_SIZE
): number {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return DEFAULT_INTELLIGENCE_LANE_POOL_SIZE;
  const parsed = Number(trimmed);
  if (parsed === 0) return 0;
  return parsed <= MAX_INTELLIGENCE_LANE_POOL_SIZE
    ? Math.max(MIN_INTELLIGENCE_LANE_POOL_SIZE, parsed)
    : DEFAULT_INTELLIGENCE_LANE_POOL_SIZE;
}

/** The lane pool reads the same datasource as the process, with its own connection limit. */
export function configureIntelligenceLanePrismaDatasource(
  rawUrl: string | undefined,
  size: number,
  transactionPooler = false
): string | undefined {
  const configured = configurePrismaDatasource(
    rawUrl,
    String(Math.max(MIN_INTELLIGENCE_LANE_POOL_SIZE, size)),
    transactionPooler
  );
  if (!configured) return configured;
  try {
    // Named so operators can tell the lane's connections apart in pg_stat_activity.
    const url = new URL(configured);
    if (!url.searchParams.has('application_name')) {
      url.searchParams.set('application_name', 'opsknight-intelligence-lane');
    }
    return url.toString();
  } catch {
    return configured;
  }
}
