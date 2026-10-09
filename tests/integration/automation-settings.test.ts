import { beforeEach, afterAll, expect, it, vi } from 'vitest';
import {
  testPrisma as db,
  resetDatabase,
  createTestUser,
  createTestService,
} from '../helpers/test-db';
import { getAutomationSettings, getIngestionAutomationConfig } from '@/lib/automation/settings';
import { processAutomationJob } from '@/lib/automation/jobs';
import { saveDraft, publishVersion, changeMode } from '@/lib/automation/versioning';
import { emptySnapshot } from '@/lib/automation/contract';
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
it('reads ingestion configuration without caching the shared emergency switch', async () => {
  const service = await createTestService('Ingestion settings');
  await db.serviceAutomationConfig.create({ data: { serviceId: service.id } });
  expect(await getIngestionAutomationConfig(db, service.id)).toBeNull();
  await saveAutomationSettings({
    automationEnabled: true,
    automationTraceRetentionDays: 90,
    expectedRevision: 0,
  });
  expect(await getIngestionAutomationConfig(db, service.id)).toEqual({
    mode: 'DISABLED',
    activeVersionId: null,
  });
  // Invalid legacy configurations must still reach the VERSION_MISSING fallback.
  await db.serviceAutomationConfig.update({
    where: { serviceId: service.id },
    data: { mode: 'SHADOW' },
  });
  expect(await getIngestionAutomationConfig(db, service.id)).toEqual({
    mode: 'SHADOW',
    activeVersionId: null,
  });
  await saveAutomationSettings({
    automationEnabled: false,
    automationTraceRetentionDays: 90,
    expectedRevision: 1,
  });
  expect(await getIngestionAutomationConfig(db, service.id)).toBeNull();
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

it('retention drains multiple batches through durable general-lane continuations', async () => {
  const service = await db.service.create({ data: { name: 'Retention backlog' } });
  const incidentIds = Array.from({ length: 2501 }, (_, index) => `retention-incident-${index}`);
  await db.incident.createMany({
    data: incidentIds.map(id => ({ id, serviceId: service.id, title: 'Historical' })),
  });
  const old = new Date(Date.now() - 100 * 86400000);
  await db.automationTrace.createMany({
    data: incidentIds.map(incidentId => ({
      incidentId,
      serviceId: service.id,
      mode: 'SHADOW' as const,
      evaluationAt: old,
      durationMs: 0,
      detail: {},
    })),
  });
  await db.automationContextObservation.createMany({
    data: Array.from({ length: 2101 }, (_, index) => ({
      serviceId: service.id,
      integrationId: 'fixture',
      integrationType: 'EVENTS_API',
      fieldKey: 'environment',
      sourcePath: 'environment',
      fieldType: 'ENUM',
      normalizedRawValueHash: String(index),
      rawValuePreview: 'old',
      firstSeenAt: old,
      lastSeenAt: old,
    })),
  });
  await processAutomationJob({ task: 'AUTOMATION_RETENTION' });
  expect(await db.automationTrace.count()).toBe(1501);
  const continuations = [];
  for (let batch = 0; batch < 4; batch++) {
    const next = await db.backgroundJob.findFirst({
      where: { status: 'PENDING', payload: { path: ['task'], equals: 'AUTOMATION_RETENTION' } },
    });
    if (!next) break;
    continuations.push(next);
    await processAutomationJob(next.payload);
    await db.backgroundJob.update({ where: { id: next.id }, data: { status: 'COMPLETED' } });
  }
  expect(continuations).toHaveLength(2);
  expect(await db.automationTrace.count()).toBe(0);
  expect(await db.automationContextObservation.count()).toBe(0);
  expect(await db.incident.count()).toBe(2501);
});

it('an in-flight continuation respects an administrator increasing retention', async () => {
  await saveAutomationSettings({
    automationEnabled: false,
    automationTraceRetentionDays: 180,
    expectedRevision: 0,
  });
  const service = await db.service.create({ data: { name: 'Retention increase' } });
  const incident = await db.incident.create({
    data: { serviceId: service.id, title: 'Keep historical trace' },
  });
  await db.automationTrace.create({
    data: {
      serviceId: service.id,
      incidentId: incident.id,
      mode: 'SHADOW',
      evaluationAt: new Date(Date.now() - 100 * 86400000),
      durationMs: 0,
      detail: {},
    },
  });
  await processAutomationJob({
    task: 'AUTOMATION_RETENTION',
    cutoff: new Date(Date.now() - 90 * 86400000).toISOString(),
  });
  expect(await db.automationTrace.count()).toBe(1);
});

it('global OFF locks operational modes, resets staged services and fences a concurrent LIVE request', async () => {
  await saveAutomationSettings({
    automationEnabled: true,
    automationTraceRetentionDays: 90,
    expectedRevision: 0,
  });
  const service = await db.service.create({ data: { name: 'Global safety' } });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: auth.actorId,
    snapshot: emptySnapshot,
    expectedRevision: 0,
  });
  const version = await publishVersion({
    serviceId: service.id,
    actorId: auth.actorId,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  const mode = {
    serviceId: service.id,
    actorId: auth.actorId,
    expectedActiveVersionId: version.id,
  };
  await expect(changeMode({ ...mode, mode: 'LIVE' })).rejects.toThrow('Acknowledge activation');
  await changeMode({ ...mode, mode: 'SHADOW' });
  await Promise.allSettled([
    changeMode({ ...mode, mode: 'LIVE', acknowledgeNoShadow: true }),
    saveAutomationSettings({
      automationEnabled: false,
      automationTraceRetentionDays: 90,
      expectedRevision: 1,
    }),
  ]);
  expect((await getAutomationSettings()).automationEnabled).toBe(false);
  expect(
    (await db.serviceAutomationConfig.findUniqueOrThrow({ where: { serviceId: service.id } })).mode
  ).toBe('DISABLED');
  await expect(changeMode({ ...mode, mode: 'SHADOW' })).rejects.toThrow('Enable global automation');
  await expect(changeMode({ ...mode, mode: 'LIVE', acknowledgeNoShadow: true })).rejects.toThrow(
    'Enable global automation'
  );
  await saveAutomationSettings({
    automationEnabled: true,
    automationTraceRetentionDays: 90,
    expectedRevision: 2,
  });
  expect(
    (await db.serviceAutomationConfig.findUniqueOrThrow({ where: { serviceId: service.id } })).mode
  ).toBe('DISABLED');
  await changeMode({ ...mode, mode: 'LIVE', acknowledgeNoShadow: true });
});

it.each([
  { steps: 51, name: 'Legacy default', reason: 'maximum step limit of 50' },
  { steps: 1, name: 'x'.repeat(65_536), reason: 'byte size limit of 65536 bytes' },
])(
  'rejects an unsafe legacy default before LIVE activation ($steps steps)',
  async ({ steps, name, reason }) => {
    await saveAutomationSettings({
      automationEnabled: true,
      automationTraceRetentionDays: 90,
      expectedRevision: 0,
    });
    const policy = await db.escalationPolicy.create({ data: { name } });
    await db.escalationRule.createMany({
      data: Array.from({ length: steps }, (_, stepOrder) => ({
        policyId: policy.id,
        stepOrder,
        delayMinutes: 0,
        targetType: 'USER' as const,
        targetUserId: auth.actorId,
        notificationChannels: ['EMAIL' as const],
      })),
    });
    const service = await db.service.create({
      data: { name: 'Legacy upgrade', escalationPolicyId: policy.id },
    });
    const draft = await saveDraft({
      serviceId: service.id,
      actorId: auth.actorId,
      snapshot: emptySnapshot,
      expectedRevision: 0,
    });
    const version = await publishVersion({
      serviceId: service.id,
      actorId: auth.actorId,
      expectedRevision: draft.revision,
      expectedActiveVersionId: null,
    });
    const input = {
      serviceId: service.id,
      actorId: auth.actorId,
      expectedActiveVersionId: version.id,
    };
    await changeMode({ ...input, mode: 'SHADOW' });
    await expect(changeMode({ ...input, mode: 'LIVE', acknowledgeNoShadow: true })).rejects.toThrow(
      reason
    );
    expect(
      (await db.serviceAutomationConfig.findUniqueOrThrow({ where: { serviceId: service.id } }))
        .mode
    ).toBe('SHADOW');
  }
);
