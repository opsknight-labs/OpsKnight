import prisma from '@/lib/prisma';

export type SlaSchedulerMode = 'LEGACY' | 'SHADOW' | 'INDEXED';

let cached: { expiresAt: number; mode: SlaSchedulerMode } | undefined;

export async function getSlaSchedulerMode(now = Date.now()): Promise<SlaSchedulerMode> {
  if (cached && cached.expiresAt > now) return cached.mode;
  const store = prisma.systemConfig;
  if (!store || typeof store.findUnique !== 'function') return 'LEGACY';
  const row = await store.findUnique({
    where: { key: 'incident_sla_scheduler' },
    select: { value: true },
  });
  const value =
    row?.value && typeof row.value === 'object' && !Array.isArray(row.value)
      ? (row.value as Record<string, unknown>)
      : {};
  const mode =
    value.mode === 'SHADOW' || value.mode === 'INDEXED' || value.mode === 'LEGACY'
      ? value.mode
      : 'LEGACY';
  cached = { expiresAt: now + 5_000, mode };
  return mode;
}

export function invalidateSlaSchedulerMode() {
  cached = undefined;
}
