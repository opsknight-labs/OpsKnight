import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testPrisma } from '../helpers/test-db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(async () => ({
    authenticated: true,
    id: 'integration-admin',
    capabilities: ['admin.manage'],
  })),
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn(async () => undefined) }));

import { saveSlaSchedulerModeAction } from '@/app/(app)/settings/incident-sla/actions';
import { recordSlaSchedulerShadowObservation } from '@/lib/incident-sla/scheduler-control';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('SLA scheduler mode PostgreSQL integration', () => {
  let original: { value: unknown; updatedBy: string | null } | null;

  beforeAll(async () => {
    original = await testPrisma.systemConfig.findUnique({
      where: { key: 'incident_sla_scheduler' },
      select: { value: true, updatedBy: true },
    });
    await testPrisma.systemConfig.upsert({
      where: { key: 'incident_sla_scheduler' },
      create: {
        key: 'incident_sla_scheduler',
        value: { mode: 'LEGACY' },
        updatedBy: 'integration-setup',
      },
      update: { value: { mode: 'LEGACY' }, updatedBy: 'integration-setup' },
    });
  });

  afterAll(async () => {
    if (original) {
      await testPrisma.systemConfig.update({
        where: { key: 'incident_sla_scheduler' },
        data: { value: original.value as never, updatedBy: original.updatedBy },
      });
    } else {
      await testPrisma.systemConfig.deleteMany({ where: { key: 'incident_sla_scheduler' } });
    }
    await testPrisma.$disconnect();
  });

  it('persists LEGACY to SHADOW and increments a clean Shadow observation', async () => {
    await expect(saveSlaSchedulerModeAction('SHADOW')).resolves.toEqual({
      ok: true,
      mode: 'SHADOW',
    });
    await recordSlaSchedulerShadowObservation({
      checkedAt: new Date('2026-09-19T12:00:00.000Z'),
      mismatches: 0,
    });

    const row = await testPrisma.systemConfig.findUniqueOrThrow({
      where: { key: 'incident_sla_scheduler' },
      select: { value: true },
    });
    expect(row.value).toMatchObject({
      mode: 'SHADOW',
      consecutiveCleanChecks: 1,
      lastShadowMismatchCount: 0,
    });
  });
});
