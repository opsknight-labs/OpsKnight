import { beforeEach, afterAll, expect, it, vi } from 'vitest';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { getAutomationSettings } from '@/lib/automation/settings';
import { processAutomationJob } from '@/lib/automation/jobs';
import { automationEnabled } from '@/lib/automation/runtime';
import { saveAutomationSettings } from '@/app/(app)/settings/system/automation-actions';
const auth = vi.hoisted(() => ({ actorId: '', denied: false }));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: async () => {
    if (auth.denied) throw new Error('Unauthorized');
    return { id: auth.actorId };
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
beforeEach(async () => {
  await resetDatabase();
  auth.actorId = (await createTestUser({ role: 'ADMIN' })).id;
  auth.denied = false;
});
afterAll(async () => {
  await db.$disconnect();
});
it('defaults off with 90 days and ignores deployment environment values', async () => {
  vi.stubEnv('OPSKNIGHT_AUTOMATION_ENABLED', 'true');
  vi.stubEnv('OPSKNIGHT_AUTOMATION_TRACE_RETENTION_DAYS', '2');
  expect(await getAutomationSettings()).toEqual({
    automationEnabled: false,
    automationTraceRetentionDays: 90,
    automationSettingsRevision: 0,
  });
  expect(await automationEnabled()).toBe(false);
  vi.unstubAllEnvs();
});
it('persists audited settings and immediately exposes disable to independent readers', async () => {
  const saved = await saveAutomationSettings({
    automationEnabled: true,
    automationTraceRetentionDays: 120,
    expectedRevision: 0,
  });
  expect(saved.automationSettingsRevision).toBe(1);
  expect(await automationEnabled()).toBe(true);
  await saveAutomationSettings({
    automationEnabled: false,
    automationTraceRetentionDays: 1,
    expectedRevision: 1,
  });
  expect(await automationEnabled(db)).toBe(false);
  expect(await db.auditLog.count({ where: { action: 'automation.settings.updated' } })).toBe(2);
});
it('concurrent administrators cannot overwrite a newer revision', async () => {
  const results = await Promise.allSettled(
    [120, 180].map(days =>
      saveAutomationSettings({
        automationEnabled: true,
        automationTraceRetentionDays: days,
        expectedRevision: 0,
      })
    )
  );
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await getAutomationSettings()).automationSettingsRevision).toBe(1);
});
it('requires administrator authorization and validates retention bounds', async () => {
  auth.denied = true;
  await expect(
    saveAutomationSettings({
      automationEnabled: true,
      automationTraceRetentionDays: 90,
      expectedRevision: 0,
    })
  ).rejects.toThrow('Unauthorized');
  auth.denied = false;
  for (const days of [0, 3651, 1.5])
    await expect(
      saveAutomationSettings({
        automationEnabled: true,
        automationTraceRetentionDays: days,
        expectedRevision: 0,
      })
    ).rejects.toThrow();
  expect(await automationEnabled()).toBe(false);
});

it('cleanup uses the retention period saved through the UI', async () => {
  await saveAutomationSettings({
    automationEnabled: false,
    automationTraceRetentionDays: 1,
    expectedRevision: 0,
  });
  const service = await db.service.create({ data: { name: 'Retention settings' } });
  for (const hours of [12, 48]) {
    const incident = await db.incident.create({
      data: { serviceId: service.id, title: String(hours) },
    });
    await db.automationTrace.create({
      data: {
        incidentId: incident.id,
        serviceId: service.id,
        mode: 'SHADOW',
        evaluationAt: new Date(Date.now() - hours * 3600000),
        durationMs: 0,
        detail: {},
      },
    });
  }
  await processAutomationJob({ task: 'AUTOMATION_RETENTION' });
  expect(await db.automationTrace.count()).toBe(1);
  expect(await db.incident.count()).toBe(2);
});
