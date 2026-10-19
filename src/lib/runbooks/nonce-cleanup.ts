import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { getRunbookMaintenanceClient } from './maintenance-db';
import { AGENT_NONCE_RETENTION_MS } from './agent-request-window';
import {
  addOperationalMetric,
  observeOperationalHistogram,
  setOperationalGauge,
} from '@/lib/metrics/operational/registry';

export const NONCE_PURGE_BATCH_SIZE = 1000;

/** One indexed batch, isolated from recovery and artifact maintenance transactions. */
export async function purgeExpiredAgentNonces(db: PrismaClient = getRunbookMaintenanceClient()) {
  const started = performance.now();
  try {
    const result = await db.$transaction(
      async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`;
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(864, 3) AS acquired`;
        if (!lock?.acquired)
          return { count: 0, hasMore: false, skipped: true, oldestExpiredAgeSeconds: 0 };
        // Use the database clock and UTC timestamp semantics of Prisma's createdAt column.
        // Retain past the entire symmetric request-validity horizon; purging never permits a valid replay.
        const candidates = await tx.$queryRaw<Array<{ id: string; expiredAgeSeconds: number }>>`
        SELECT "id", EXTRACT(EPOCH FROM (timezone('UTC', CURRENT_TIMESTAMP) - "createdAt"))::double precision
          - ${AGENT_NONCE_RETENTION_MS / 1000} AS "expiredAgeSeconds"
        FROM "RunbookAgentRequestNonce"
        WHERE "createdAt" < timezone('UTC', CURRENT_TIMESTAMP) - (${AGENT_NONCE_RETENTION_MS} * INTERVAL '1 millisecond')
        ORDER BY "createdAt" LIMIT ${NONCE_PURGE_BATCH_SIZE} FOR UPDATE SKIP LOCKED`;
        const deleted = candidates.length
          ? await tx.runbookAgentRequestNonce.deleteMany({
              where: { id: { in: candidates.map(row => row.id) } },
            })
          : { count: 0 };
        return {
          count: deleted.count,
          hasMore: candidates.length === NONCE_PURGE_BATCH_SIZE,
          skipped: false,
          oldestExpiredAgeSeconds: Math.max(0, candidates[0]?.expiredAgeSeconds ?? 0),
        };
      },
      { timeout: 2500, maxWait: 500 }
    );
    addOperationalMetric('opsknight_runbook_nonce_purge_rows_total', result.count);
    addOperationalMetric('opsknight_runbook_nonce_purge_batches_total', 1, {
      result: result.skipped ? 'skipped' : 'success',
    });
    if (!result.skipped)
      setOperationalGauge(
        'opsknight_runbook_nonce_purge_oldest_expired_age_seconds',
        result.oldestExpiredAgeSeconds
      );
    return result;
  } catch (error) {
    addOperationalMetric('opsknight_runbook_nonce_purge_batches_total', 1, { result: 'failed' });
    throw error;
  } finally {
    observeOperationalHistogram(
      'opsknight_runbook_nonce_purge_duration_seconds',
      (performance.now() - started) / 1000
    );
  }
}
