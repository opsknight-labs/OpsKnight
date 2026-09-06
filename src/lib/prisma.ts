import { PrismaClient } from '@prisma/client';
import { configurePrismaDatasource } from './prisma-datasource';

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

const prismaClientSingleton = () => {
  // Log configuration for debugging
  const logLevel: Array<'error' | 'warn'> = ['error', 'warn'];
  const datasourceUrl = configurePrismaDatasource(
    process.env.DATABASE_URL,
    process.env.DATABASE_POOL_SIZE
  );

  return new PrismaClient({
    log: logLevel,
    // Datasource configuration can be overridden via env
    datasourceUrl,
  });
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
