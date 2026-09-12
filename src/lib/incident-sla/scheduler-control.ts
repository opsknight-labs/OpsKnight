import prisma from '@/lib/prisma';
import { addOperationalMetric, setOperationalGauge } from '@/lib/metrics/operational/registry';
import type { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

export type SlaSchedulerMode = 'LEGACY' | 'SHADOW' | 'INDEXED';
export const MIN_CLEAN_SHADOW_CHECKS = 3;

let cached: { expiresAt: number; mode: SlaSchedulerMode } | undefined;

export async function getSlaSchedulerMode(now = Date.now()): Promise<SlaSchedulerMode> {
  if (cached && cached.expiresAt > now) return cached.mode;
  const store = prisma.systemConfig;
  if (!store || typeof store.findUnique !== 'function') return 'LEGACY';
  let row: { value: unknown } | null = null;
  try {
    row = await store.findUnique({
      where: { key: 'incident_sla_scheduler' },
      select: { value: true },
    });
  } catch (error) {
    // Scheduler configuration is an optimization control. A config-store outage
    // must retain the established scanner rather than stopping SLA monitoring.
    logger.warn('[SLA Scheduler] Unable to read runtime configuration; using legacy mode', {
      error,
    });
    cached = { expiresAt: now + 10_000, mode: 'LEGACY' };
    addOperationalMetric('opsknight_sla_scheduler_config_read_failures_total', 1, {
      fallback: 'legacy',
    });
    for (const candidate of ['LEGACY', 'SHADOW', 'INDEXED'] as const)
      setOperationalGauge('opsknight_sla_scheduler_mode', candidate === 'LEGACY' ? 1 : 0, {
        mode: candidate.toLowerCase(),
      });
    return 'LEGACY';
  }
  const value =
    row?.value && typeof row.value === 'object' && !Array.isArray(row.value)
      ? (row.value as Record<string, unknown>)
      : {};
  const mode =
    value.mode === 'SHADOW' || value.mode === 'INDEXED' || value.mode === 'LEGACY'
      ? value.mode
      : 'LEGACY';
  cached = { expiresAt: now + 5_000, mode };
  for (const candidate of ['LEGACY', 'SHADOW', 'INDEXED'] as const)
    setOperationalGauge('opsknight_sla_scheduler_mode', candidate === mode ? 1 : 0, {
      mode: candidate.toLowerCase(),
    });
  return mode;
}

export async function recordSlaSchedulerShadowObservation(input: {
  checkedAt: Date;
  mismatches: number;
}) {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: 'incident_sla_scheduler' },
      select: { value: true, updatedBy: true },
    });
    const value =
      row?.value && typeof row.value === 'object' && !Array.isArray(row.value)
        ? (row.value as Record<string, unknown>)
        : {};
    if (value.mode !== 'SHADOW') return;
    const cleanChecks = input.mismatches === 0 ? Number(value.consecutiveCleanChecks ?? 0) + 1 : 0;
    await prisma.systemConfig.update({
      where: { key: 'incident_sla_scheduler' },
      data: {
        value: {
          ...value,
          lastShadowCheckAt: input.checkedAt.toISOString(),
          ...(input.mismatches > 0 ? { lastShadowMismatchAt: input.checkedAt.toISOString() } : {}),
          consecutiveCleanChecks: cleanChecks,
          lastShadowMismatchCount: input.mismatches,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    logger.warn('[SLA Scheduler] Unable to persist shadow observation', { error });
  }
}

export function invalidateSlaSchedulerMode() {
  cached = undefined;
}
