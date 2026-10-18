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
