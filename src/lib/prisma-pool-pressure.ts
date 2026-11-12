import 'server-only';
import prisma from './prisma';

interface MetricsReader {
  $metrics: { json(): Promise<{ gauges: Array<{ key: string; value: number }> }> };
}

/** Engine-local observation: never borrows a connection from the pool being measured. */
export async function getPrismaPoolWaitCount(
  client: MetricsReader = prisma
): Promise<number | null> {
  try {
    const { gauges } = await client.$metrics.json();
    const waiting = gauges.find(metric => metric.key === 'prisma_client_queries_wait')?.value;
    return typeof waiting === 'number' && Number.isFinite(waiting) && waiting >= 0 ? waiting : null;
  } catch {
    // Missing metrics are unknown, never a fabricated healthy measurement. Paging-lag protection
    // remains active on clients/runtimes that do not expose engine metrics.
    return null;
  }
}
