import prisma from '@/lib/prisma';

/** Existing split deployments have web replicas but no ingestion-worker service.
 * Web can drain one receipt using its existing pool. Dedicated healthy workers
 * suppress that fallback; liveness uses PostgreSQL time across replicas.
 */
export async function hasHealthyDedicatedIngestionWorker(): Promise<boolean> {
  const [row] = await prisma.$queryRaw<Array<{ healthy: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "RuntimeWorkerHeartbeat"
      WHERE lane = 'ingestion' AND role = 'ingestion-worker' AND running = true
        AND "lastError" IS NULL AND "lastSuccessAt" IS NOT NULL
        AND "lastSeenAt" > clock_timestamp() - INTERVAL '30 seconds'
    ) AS healthy`;
  return row?.healthy === true;
}
