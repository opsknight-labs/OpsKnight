import { getMaintenanceClient } from '@/lib/maintenance/database';
import { logger } from '@/lib/logger';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import { ingestionConfig } from './config';
import {
  pruneInactiveIngestionQuotas,
  pruneCompletedIngestionPayloads,
  pruneSharedIngestionPayloads,
  pruneExpiredIngestionReceipts,
  pruneExpiredIngestionBatches,
} from './retention';

const tasks = [
  ['payloads', pruneCompletedIngestionPayloads],
  ['shared_payloads', pruneSharedIngestionPayloads],
  ['receipts', pruneExpiredIngestionReceipts],
  ['batches', pruneExpiredIngestionBatches],
  ['quotas', pruneInactiveIngestionQuotas],
] as const;
let timer: NodeJS.Timeout | null = null;
let active: Promise<void> | null = null;
let cursor = 0;
const nextAt = new Map<number, number>();

/** Rotate through cleanup classes; a busy class cannot starve the others.
 * At most 20 bounded transactions per tick and 250ms before starting another.
 * The dedicated pool prevents cleanup from consuming ingestion/recovery slots.
 * Each transaction can exceed the tick budget only up to its own 2.5s timeout.
 */
export async function runIngestionMaintenanceTick(): Promise<void> {
  const started = performance.now();
  let visited = 0;
  let batches = 0;
  while (visited < tasks.length && batches < 20 && performance.now() - started < 250) {
    const index = cursor;
    cursor = (cursor + 1) % tasks.length;
    if (Date.now() < (nextAt.get(index) ?? 0)) {
      visited += 1;
      continue;
    }
    const task = tasks.at(index);
    if (!task) break;
    const [kind, prune] = task;
    batches += 1;
    try {
      const count = await prune(getMaintenanceClient());
      addOperationalMetric('opsknight_ingestion_retention_rows_total', count, { kind });
      addOperationalMetric('opsknight_ingestion_retention_batches_total', 1, {
        kind,
        outcome: 'success',
      });
      nextAt.set(index, Date.now() + (count === 100 ? 0 : 60000));
      // A full batch remains due on the next rotation; other classes get a turn first.
      visited = count === 100 ? 0 : visited + 1;
    } catch {
      nextAt.set(index, Date.now() + 60000);
      visited += 1;
      addOperationalMetric('opsknight_ingestion_retention_batches_total', 1, {
        kind,
        outcome: 'failed',
      });
      logger.warn('ingestion.retention_unavailable', { kind });
    }
  }
  observeOperationalHistogram(
    'opsknight_ingestion_retention_tick_duration_ms',
    performance.now() - started
  );
}

export function startIngestionMaintenance(): void {
  if (timer || ingestionConfig().mode !== 'postgres') return;
  cursor = 0;
  nextAt.clear();
  timer = setInterval(() => {
    if (active) return;
    active = runIngestionMaintenanceTick().finally(() => {
      active = null;
    });
  }, 1000);
  timer.unref?.();
}

export async function stopIngestionMaintenance(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  await active;
  // The scheduler closes the shared maintenance pool after all maintenance stops.
}
