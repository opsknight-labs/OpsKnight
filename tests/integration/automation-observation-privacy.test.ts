import { persistObservationBatch } from '@/lib/automation/observation-batch';
import { beforeEach, expect, it } from 'vitest';
import {
  testPrisma as db,
  resetDatabase,
  createTestService,
  createTestUser,
} from '../helpers/test-db';
import { processAutomationJob, type ObservationJob } from '@/lib/automation/jobs';
import { updateAutomationSettings } from '@/lib/automation/settings-command';
import {
  protectObservationValues,
  observationValueHash,
} from '@/lib/automation/observation-privacy';
import { randomUUID } from 'node:crypto';

beforeEach(async () => {
  await resetDatabase();
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true, automationStoreObservationPreviews: false },
  });
});
it('keeps values out of default-off jobs and observation rows while retaining counts', async () => {
  const service = await createTestService('Private discovery');
  const safe = {
    key: 'environment',
    path: 'payload.environment',
    value: 'private-environment-name',
    type: 'STRING',
    unmapped: true,
  };
  const observations = protectObservationValues(
    service.id,
    [safe, { ...safe, key: 'customer_email', value: 'person@example.com' }],
    false
  );
  expect(observations).toHaveLength(1);
  expect(observations[0].value).toBe('');
  const payload = {
    task: 'AUTOMATION_OBSERVE',
    logicalKey: randomUUID(),
    serviceId: service.id,
    integrationId: 'fixture',
    integrationType: 'EVENTS_API',
    observations,
  };
  await db.backgroundJob.create({
    data: { id: payload.logicalKey, type: 'SCHEDULED_TASK', scheduledAt: new Date(), payload },
  });
  await processAutomationJob(payload);
  const row = await db.automationContextObservation.findFirstOrThrow({
    where: { serviceId: service.id },
  });
  expect(row).toMatchObject({
    rawValuePreview: '',
    count: 1,
    normalizedRawValueHash: observationValueHash(service.id, safe.value),
  });
  expect(
    JSON.stringify(
      (await db.backgroundJob.findUniqueOrThrow({ where: { id: payload.logicalKey } })).payload
    )
  ).not.toContain(safe.value);
});
it('requires explicit opt-in and clears persisted and queued previews on disablement', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const enabled = await updateAutomationSettings(
    {
      automationEnabled: true,
      automationTraceRetentionDays: 90,
      expectedRevision: 0,
      automationStoreObservationPreviews: true,
    },
    { source: 'UI', actorId: actor.id }
  );
  const service = await createTestService('Opt-in discovery');
  const observation = {
    key: 'environment',
    path: 'payload.environment',
    value: 'private-environment',
    type: 'STRING',
    unmapped: false,
  };
  const observations = protectObservationValues(service.id, [observation], true);
  const payload = {
    task: 'AUTOMATION_OBSERVE',
    logicalKey: randomUUID(),
    serviceId: service.id,
    integrationId: 'fixture',
    integrationType: 'EVENTS_API',
    observations,
  };
  await processAutomationJob(payload);
  expect(
    (await db.automationContextObservation.findFirstOrThrow({ where: { serviceId: service.id } }))
      .rawValuePreview
  ).toBe(observation.value);
  await db.backgroundJob.create({
    data: { id: payload.logicalKey, type: 'SCHEDULED_TASK', scheduledAt: new Date(), payload },
  });
  await updateAutomationSettings(
    {
      automationEnabled: true,
      automationTraceRetentionDays: 90,
      expectedRevision: enabled.automationSettingsRevision,
      automationStoreObservationPreviews: false,
    },
    { source: 'UI', actorId: actor.id }
  );
  expect(
    (await db.automationContextObservation.findFirstOrThrow({ where: { serviceId: service.id } }))
      .rawValuePreview
  ).toBe('');
  const queued = await db.backgroundJob.findUniqueOrThrow({ where: { id: payload.logicalKey } });
  expect(JSON.stringify(queued.payload)).not.toContain(observation.value);
});
it('excludes personal values from legacy jobs and clears legacy durable payloads after processing', async () => {
  const service = await createTestService('Legacy privacy');
  const payload = {
    task: 'AUTOMATION_OBSERVE',
    logicalKey: randomUUID(),
    serviceId: service.id,
    integrationId: 'fixture',
    integrationType: 'EVENTS_API',
    observations: [
      {
        key: 'customer_email',
        path: 'payload.customer_email',
        value: 'person@example.com',
        type: 'STRING',
        unmapped: false,
      },
      {
        key: 'environment',
        path: 'payload.environment',
        value: 'production',
        type: 'STRING',
        unmapped: false,
      },
    ],
  };
  await db.backgroundJob.create({
    data: { id: payload.logicalKey, type: 'SCHEDULED_TASK', scheduledAt: new Date(), payload },
  });
  await processAutomationJob(payload);
  expect(await db.automationContextObservation.count({ where: { serviceId: service.id } })).toBe(1);
  expect(
    JSON.stringify(
      (await db.backgroundJob.findUniqueOrThrow({ where: { id: payload.logicalKey } })).payload
    )
  ).not.toContain('person@example.com');
});

it('fences in-flight worker preview writes against administrative disablement', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const settings = await updateAutomationSettings(
    {
      automationEnabled: true,
      automationTraceRetentionDays: 90,
      automationStoreObservationPreviews: true,
      expectedRevision: 0,
    },
    { source: 'UI', actorId: actor.id }
  );
  const service = await createTestService('Preview privacy race');
  const payload: ObservationJob = {
    task: 'AUTOMATION_OBSERVE',
    logicalKey: randomUUID(),
    serviceId: service.id,
    integrationId: 'race',
    integrationType: 'EVENTS_API',
    observations: protectObservationValues(
      service.id,
      [
        {
          key: 'environment',
          path: 'payload.environment',
          value: 'private-racing-value',
          type: 'STRING',
          unmapped: false,
        },
      ],
      true
    ),
  };
  await db.backgroundJob.create({
    data: { id: payload.logicalKey, type: 'SCHEDULED_TASK', scheduledAt: new Date(), payload },
  });
  let releaseWorker!: () => void, workerReady!: () => void;
  const hold = new Promise<void>(resolve => {
    releaseWorker = resolve;
  });
  const ready = new Promise<void>(resolve => {
    workerReady = resolve;
  });
  const worker = db.$transaction(async tx => {
    await persistObservationBatch(tx, payload, () => null);
    workerReady();
    await hold;
  });
  try {
    await ready;
    const disable = updateAutomationSettings(
      {
        automationEnabled: true,
        automationTraceRetentionDays: 90,
        automationStoreObservationPreviews: false,
        expectedRevision: settings.automationSettingsRevision,
      },
      { source: 'UI', actorId: actor.id }
    );
    releaseWorker();
    await worker;
    await disable;
    expect(
      (await db.automationContextObservation.findFirstOrThrow({ where: { serviceId: service.id } }))
        .rawValuePreview
    ).toBe('');
    expect(
      JSON.stringify(
        (await db.backgroundJob.findUniqueOrThrow({ where: { id: payload.logicalKey } })).payload
      )
    ).not.toContain('private-racing-value');
  } finally {
    releaseWorker();
    await worker;
  }
});

it('does not recount a scrubbed observation payload after processing commits before queue completion', async () => {
  const service = await createTestService('Crash replay identity');
  await db.systemSettings.update({
    where: { id: 'default' },
    data: { automationStoreObservationPreviews: true },
  });
  const version = await db.automationVersion.create({
    data: {
      serviceId: service.id,
      versionNumber: 1,
      snapshot: { schemaVersion: 1, fields: [], rules: [] },
      compiledSnapshot: {},
      checksum: 'fixture',
      publishedBy: 'fixture',
      lintReport: [],
    },
  });
  const bucketDate = new Date(new Date().toISOString().slice(0, 10));
  const payload: ObservationJob = {
    task: 'AUTOMATION_OBSERVE',
    logicalKey: randomUUID(),
    serviceId: service.id,
    shadow: {
      versionId: version.id,
      bucketDate: bucketDate.toISOString(),
      evaluated: 1,
      same: 1,
      priorityDifferent: 0,
      routeDifferent: 0,
      noEscalationDifferent: 0,
      errors: 0,
      fallbacks: 0,
    },
    integrationId: 'crash-fixture',
    integrationType: 'EVENTS_API',
    observations: protectObservationValues(
      service.id,
      [
        {
          key: 'environment',
          path: 'payload.environment',
          type: 'STRING',
          value: 'preview-before-crash',
          unmapped: false,
        },
      ],
      true
    ),
  };
  await db.backgroundJob.create({
    data: {
      id: payload.logicalKey,
      type: 'SCHEDULED_TASK',
      status: 'PROCESSING',
      scheduledAt: new Date(),
      payload,
    },
  });
  await processAutomationJob(payload);
  const committed = await db.backgroundJob.findUniqueOrThrow({ where: { id: payload.logicalKey } });
  expect(committed.status).toBe('PROCESSING');
  expect(JSON.stringify(committed.payload)).not.toContain('preview-before-crash');
  // Reclaim the source row without the queue's successful completion update.
  await db.backgroundJob.update({
    where: { id: payload.logicalKey },
    data: { status: 'PENDING', attempts: { increment: 1 } },
  });
  await processAutomationJob(committed.payload);
  expect(
    (
      await db.automationShadowAggregate.findUniqueOrThrow({
        where: {
          serviceId_versionId_bucketDate: {
            serviceId: service.id,
            versionId: version.id,
            bucketDate,
          },
        },
      })
    ).evaluated
  ).toBe(1);
  expect(
    (await db.automationContextObservation.findFirstOrThrow({ where: { serviceId: service.id } }))
      .count
  ).toBe(1);
});

it('commits emergency OFF even when diagnostic cleanup fails, then retries durable cleanup', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const service = await createTestService('Emergency OFF');
  await db.serviceAutomationConfig.create({ data: { serviceId: service.id, mode: 'SHADOW' } });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION test_preview_cleanup_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Diagnostic cleanup unavailable'; END; $$`
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER test_preview_cleanup_failure_trigger BEFORE UPDATE ON "AutomationContextObservation" FOR EACH STATEMENT EXECUTE FUNCTION test_preview_cleanup_failure()`
  );
  let cleanupId = '';
  try {
    const current = await db.systemSettings.findUniqueOrThrow({ where: { id: 'default' } });
    const off = await updateAutomationSettings(
      {
        automationEnabled: false,
        automationTraceRetentionDays: 90,
        expectedRevision: current.automationSettingsRevision,
      },
      { source: 'UI', actorId: actor.id }
    );
    expect(off.automationEnabled).toBe(false);
    expect(
      (await db.serviceAutomationConfig.findUniqueOrThrow({ where: { serviceId: service.id } }))
        .mode
    ).toBe('DISABLED');
    const cleanup = await db.backgroundJob.findFirstOrThrow({
      where: { id: { startsWith: 'AUTOMATION_PRIVACY_CLEANUP:' } },
    });
    cleanupId = cleanup.id;
    await expect(processAutomationJob(cleanup.payload)).rejects.toThrow();
    expect(
      (await db.systemSettings.findUniqueOrThrow({ where: { id: 'default' } })).automationEnabled
    ).toBe(false);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_preview_cleanup_failure_trigger ON "AutomationContextObservation"'
    );
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_preview_cleanup_failure()');
  }
  await processAutomationJob(
    (await db.backgroundJob.findUniqueOrThrow({ where: { id: cleanupId } })).payload
  );
});

it('does not rewrite diagnostic history for retention-only saves while previews are already OFF', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION test_unrelated_cleanup_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Unrelated cleanup attempted'; END; $$`
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER test_unrelated_cleanup_failure_trigger BEFORE UPDATE ON "AutomationContextObservation" FOR EACH STATEMENT EXECUTE FUNCTION test_unrelated_cleanup_failure()`
  );
  try {
    const current = await db.systemSettings.findUniqueOrThrow({ where: { id: 'default' } });
    const saved = await updateAutomationSettings(
      {
        automationEnabled: true,
        automationTraceRetentionDays: 91,
        expectedRevision: current.automationSettingsRevision,
      },
      { source: 'UI', actorId: actor.id }
    );
    expect(saved.automationTraceRetentionDays).toBe(91);
    expect(
      await db.backgroundJob.count({ where: { id: { startsWith: 'AUTOMATION_PRIVACY_CLEANUP:' } } })
    ).toBe(0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_unrelated_cleanup_failure_trigger ON "AutomationContextObservation"'
    );
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_unrelated_cleanup_failure()');
  }
});
it('classifies an invalid global enablement as an actionable conflict', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const service = await createTestService('Invalid enablement');
  await db.systemSettings.update({ where: { id: 'default' }, data: { automationEnabled: false } });
  await db.serviceAutomationConfig.create({ data: { serviceId: service.id, mode: 'SHADOW' } });
  const current = await db.systemSettings.findUniqueOrThrow({ where: { id: 'default' } });
  await expect(
    updateAutomationSettings(
      {
        automationEnabled: true,
        automationTraceRetentionDays: 90,
        expectedRevision: current.automationSettingsRevision,
      },
      { source: 'UI', actorId: actor.id }
    )
  ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
});
