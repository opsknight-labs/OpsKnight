import { PrismaClient } from '@prisma/client';
import { configurePrismaDatasource, selectPrismaDatasourceUrl } from './prisma-datasource';
import { getOpsKnightProcessRole } from './runtime-role';

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
  }
}

const prismaClientSingleton = () => {
  const role = getOpsKnightProcessRole();
  const rawDatasourceUrl = selectPrismaDatasourceUrl(role);
  // Log configuration for debugging
  const datasourceUrl = configurePrismaDatasource(
    rawDatasourceUrl,
    rolePoolSize() ?? process.env.DATABASE_POOL_SIZE
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
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();
// Next.js may evaluate this module in multiple chunks even in production. Keep
// one client per process so every chunk shares the same connection pool.
globalThis.prismaGlobal = prisma;

// Connection pool health check
export async function checkDatabaseHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (_error) {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

// Graceful shutdown helper
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export default prisma;
