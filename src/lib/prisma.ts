import { PrismaClient } from '@prisma/client';
import {
  configureIntelligenceLanePrismaDatasource,
  configurePrismaDatasource,
  configureMcpPrismaDatasource,
  DEFAULT_INTELLIGENCE_LANE_POOL_SIZE,
  intelligenceLanePoolSize,
  isIntelligenceLaneThread,
  selectMcpPrismaDatasourceUrl,
  selectPrismaDatasourceUrl,
} from './prisma-datasource';
import { getOpsKnightProcessRole, isDedicatedHttpRole } from './runtime-role';
import type {} from './database-workload';

/**
 * Prisma Client Configuration for Scale
 *
 * Connection pool settings for handling 100-500+ concurrent users:
 * - connection_limit: Max connections per instance (safe default: 10)
 * - pool_timeout: How long to wait for a connection
 * - statement_cache_size: Prepared statement cache
 *
 * Configure via DATABASE_URL query params or environment variables:
 * DATABASE_URL="postgresql://...?connection_limit=10&pool_timeout=30"
 */

function rolePoolSize(): string | undefined {
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

const prismaClientSingleton = (workload: 'primary' | 'mcp' | 'intelligence' = 'primary') => {
  const role = getOpsKnightProcessRole();
  const rawDatasourceUrl = selectPrismaDatasourceUrl(role);
  const transactionPooler = isDedicatedHttpRole(role) && process.env.PGBOUNCER_ENABLED === 'true';
  // A lane thread's process client is the lane's own pool (see intelligence/jobs/lane-thread.ts).
  const laneWorkload =
    workload === 'intelligence' || (workload === 'primary' && isIntelligenceLaneThread());
  const datasourceUrl =
    workload === 'mcp'
      ? configureMcpPrismaDatasource(
          selectMcpPrismaDatasourceUrl(),
          process.env.MCP_DATABASE_POOL_SIZE
        )
      : laneWorkload
        ? configureIntelligenceLanePrismaDatasource(
            rawDatasourceUrl,
            intelligenceLanePoolSize() || DEFAULT_INTELLIGENCE_LANE_POOL_SIZE,
            transactionPooler
          )
        : configurePrismaDatasource(
            rawDatasourceUrl,
            rolePoolSize() ?? process.env.DATABASE_POOL_SIZE,
            transactionPooler
          );

  const client = new PrismaClient({
    log: [
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
      { emit: 'event', level: 'query' },
    ],
    // Datasource configuration can be overridden via env
    datasourceUrl,
  });
  const slowQueryMs = Math.max(
    1,
    Number.parseInt(process.env.PRISMA_SLOW_QUERY_MS ?? '500', 10) || 500
  );
  client.$on('query', event => {
    if (event.duration < slowQueryMs) return;
    // Never log query parameters: they may contain credentials or user data.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'prisma.slow_query',
        workload,
        durationMs: event.duration,
        target: event.target,
        timestamp: new Date().toISOString(),
      })
    );
  });
  return client;
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
  var prismaMcpGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
  var prismaIntelligenceGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

const primary = globalThis.prismaGlobal ?? prismaClientSingleton();
// Next.js may evaluate this module in multiple chunks even in production. Keep
// one client per process so every chunk shares the same connection pool.
globalThis.prismaGlobal = primary;

// Resolve at invocation time so existing shared domain commands use MCP's pool
// throughout nested calls. Interactive transaction clients remain Prisma's own
// pinned clients. Outside the in-process context, behavior stays on primary.
const prisma = new Proxy(primary, {
  get(_target, property) {
    // Read the server-installed context without importing async_hooks here:
    // legacy client utility imports also traverse this module's browser stub.
    // The intelligence lane only enters its workload when it shares this process with ingestion
    // and has a pool of its own configured (see intelligence/jobs/lane-pool.ts).
    const workload = globalThis.opsKnightDatabaseWorkload?.getStore();
    const client =
      workload === 'mcp'
        ? (globalThis.prismaMcpGlobal ??= prismaClientSingleton('mcp'))
        : workload === 'intelligence'
          ? (globalThis.prismaIntelligenceGlobal ??= prismaClientSingleton('intelligence'))
          : primary;
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

// Connection pool health check
export async function checkDatabaseHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await primary.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (_error) {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

// Graceful shutdown helper
export async function disconnectPrisma(): Promise<void> {
  await Promise.all([
    primary.$disconnect(),
    globalThis.prismaMcpGlobal?.$disconnect(),
    globalThis.prismaIntelligenceGlobal?.$disconnect(),
  ]);
}

export default prisma;
