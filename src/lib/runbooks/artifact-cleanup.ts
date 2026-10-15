import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { getRunbookMaintenanceClient, disconnectRunbookMaintenanceClient } from './maintenance-db';
import { purgeExpiredAgentNonces } from './nonce-cleanup';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import { logger } from '@/lib/logger';

export const ARTIFACT_PURGE_BATCH_SIZE = 100;
export const ARTIFACT_PURGE_BATCH_BYTES = 16 * 1024 * 1024;
/** One bounded transaction per minute; never called by execution reconciliation. */
export async function purgeExpiredRunbookArtifacts(
  db: PrismaClient = getRunbookMaintenanceClient()
) {
  const started = performance.now();
  try {
    const result = await db.$transaction(
      async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`;
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(864, 2) AS acquired`;
        if (!lock?.acquired) return { count: 0, bytes: 0, hasMore: false, skipped: true };
        const retention = await tx.systemSettings.findUnique({
          where: { id: 'default' },
          select: { runbookArtifactRetentionDays: true },
        });
        const configured =
          retention?.runbookArtifactRetentionDays ??
          Number.parseInt(process.env.RUNBOOK_ARTIFACT_RETENTION_DAYS ?? '30', 10);
        const days = Number.isFinite(configured) ? Math.min(3650, Math.max(1, configured)) : 30;
        const cutoff = new Date(Date.now() - days * 86_400_000);
        const candidates = await tx.$queryRaw<Array<{ id: string; sizeBytes: number }>>`
        SELECT "id", "sizeBytes" FROM "RunbookArtifact"
        WHERE "createdAt" < ${cutoff} ORDER BY "createdAt", "id"
        LIMIT ${ARTIFACT_PURGE_BATCH_SIZE} FOR UPDATE SKIP LOCKED`;
        const ids: string[] = [];
        let bytes = 0;
        for (const row of candidates) {
          if (ids.length && bytes + row.sizeBytes > ARTIFACT_PURGE_BATCH_BYTES) break;
          ids.push(row.id);
          bytes += row.sizeBytes;
        }
        const deleted = ids.length
          ? await tx.runbookArtifact.deleteMany({
              where: { id: { in: ids }, createdAt: { lt: cutoff } },
            })
          : { count: 0 };
        return {
          count: deleted.count,
          bytes,
          hasMore:
            candidates.length === ARTIFACT_PURGE_BATCH_SIZE || ids.length < candidates.length,
          skipped: false,
        };
      },
      { timeout: 2500, maxWait: 500 }
    );
    addOperationalMetric('opsknight_runbook_artifact_purge_rows_total', result.count);
    addOperationalMetric('opsknight_runbook_artifact_purge_bytes_total', result.bytes);
    addOperationalMetric('opsknight_runbook_artifact_purge_batches_total', 1, {
      result: result.skipped ? 'skipped' : 'success',
    });
    return result;
  } catch (error) {
    addOperationalMetric('opsknight_runbook_artifact_purge_batches_total', 1, { result: 'failed' });
    throw error;
  } finally {
    observeOperationalHistogram(
      'opsknight_runbook_artifact_purge_duration_seconds',
      (performance.now() - started) / 1000
    );
  }
}
let timer: NodeJS.Timeout | null = null;
let active: Promise<void> | null = null;
let nextArtifactBatchAt = 0;
function tick() {
  if (active) return;
  active = (async () => {
    // A failed artifact batch must not prevent nonce maintenance, or vice versa.
    const artifactDue = Date.now() >= nextArtifactBatchAt;
    if (artifactDue) nextArtifactBatchAt = Date.now() + 60_000;
    const batches = artifactDue
      ? [purgeExpiredRunbookArtifacts, purgeExpiredAgentNonces]
      : [purgeExpiredAgentNonces];
    for (const purge of batches) {
      try {
        await purge();
      } catch {
        logger.warn(
          '[RunbookMaintenance] Batch deferred; inspect maintenance metrics and database health'
        );
      }
    }
  })().finally(() => {
    active = null;
  });
}
export function startRunbookArtifactCleanup() {
  if (timer) return;
  nextArtifactBatchAt = Date.now() + 60_000;
  // Nonces are high-volume request records: allow one bounded batch per second.
  // Artifacts retain their one-minute cadence. Slow batches skip ticks rather than overlap.
  timer = setInterval(tick, 1000);
  timer.unref?.();
}
export async function stopRunbookArtifactCleanup() {
  if (timer) clearInterval(timer);
  timer = null;
  await active;
  await disconnectRunbookMaintenanceClient();
}
