import 'server-only';
import { poolWaitingCount } from '@/lib/db/create-client';
import prisma from './prisma';

/**
 * Engine-local observation: never borrows a connection from the pool being measured. It always reads
 * the process pool that ingestion and paging use, even when called from a workload that has a pool of
 * its own (the intelligence lane in a shared process), because that is the pool the lane protects.
 */
export async function getPrismaPoolWaitCount(
  client: object = globalThis.prismaGlobal ?? prisma
): Promise<number | null> {
  // Unknown (null) is never a fabricated healthy measurement: paging-lag protection stays active
  // for clients that are not built by createPrismaClient.
  const waiting = poolWaitingCount(client);
  return waiting !== null && Number.isFinite(waiting) && waiting >= 0 ? waiting : null;
}
