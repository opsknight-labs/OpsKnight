import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { planMaintenance } from './partitioning';

/**
 * Lane-side upkeep for an Alert table converted by scripts/partition-alerts.ts. Off unless
 * ALERT_PARTITION_MAINTENANCE=on, and a no-op while "Alert" is not partitioned.
 */
export const alertPartitionMaintenanceEnabled = () =>
  process.env.ALERT_PARTITION_MAINTENANCE === 'on';

const bounded = (raw: string | undefined, fallback: number, max: number) => {
  const value = Number(raw ?? fallback);
  return Number.isInteger(value) && value >= 0 && value <= max ? value : fallback;
};

export async function maintainAlertPartitions(now: Date = new Date()) {
  const [partitioned] = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM pg_partitioned_table WHERE partrelid = to_regclass('"Alert"')) AS ok`;
  if (!partitioned?.ok) return { created: 0, detached: 0, partitioned: false };
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = to_regclass('"Alert"')`;
  const plan = planMaintenance({
    existing: rows.map(row => row.name),
    now,
    monthsAhead: Math.max(1, bounded(process.env.ALERT_PARTITION_MONTHS_AHEAD, 3, 24)),
    retentionMonths: bounded(process.env.ALERT_PARTITION_RETENTION_MONTHS, 0, 120),
  });
  let created = 0;
  let detached = 0;
  const steps = [
    ...plan.create.map(sql => ({ sql, kind: 'create' as const })),
    ...plan.detach.map(sql => ({ sql, kind: 'detach' as const })),
  ];
  for (const step of steps) {
    try {
      // Both statements briefly lock the parent; give up quickly and retry next sweep when busy.
      await prisma.$transaction([
        prisma.$executeRawUnsafe(`SET LOCAL lock_timeout = '2s'`),
        prisma.$executeRawUnsafe(step.sql),
      ]);
      if (step.kind === 'create') created += 1;
      else detached += 1;
    } catch (error) {
      logger.warn('[Alerts] Partition maintenance step failed; will retry', {
        kind: step.kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { created, detached, partitioned: true };
}
