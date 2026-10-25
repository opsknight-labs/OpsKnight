/* eslint-disable @typescript-eslint/no-require-imports -- Shared CommonJS isolated certification controller. */
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');

function capacityStage(value = 'full-stack') {
  assert.ok(
    ['full-stack', 'admission-only', 'incident-only', 'effects-only'].includes(value),
    'Unknown capacity stage'
  );
  return value;
}

function cpuUsageDelta(before, after) {
  const baseline = new Map(before.map(row => [row.name, row]));
  const processes = after.map(row => {
    assert.ok(row.running && !row.oomKilled, 'Stage process exited or exhausted memory');
    const start = baseline.get(row.name)?.cgroup?.cpu?.usage_usec;
    const end = row.cgroup?.cpu?.usage_usec;
    assert.ok(
      Number.isFinite(start) && Number.isFinite(end) && end >= start,
      'CPU counters missing or reset during measurement'
    );
    return { name: row.name, cpuSeconds: (end - start) / 1000000 };
  });
  assert.equal(processes.length, before.length);
  return {
    processes,
    totalCpuSeconds: processes.reduce((sum, row) => sum + row.cpuSeconds, 0),
    scope:
      'Per-process cgroup CPU deltas over resource snapshot interval; includes diagnostic overhead. Full-stack/admission interval also includes configured preflight and warmup.',
  };
}

async function prepareStageFixture(prisma, stage, count) {
  assert.ok(['incident-only', 'effects-only'].includes(stage));
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 10000);
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '55445');
  assert.ok(url.pathname.startsWith('/ingestion_test_http_'));
  const [isolation] = await prisma.$queryRaw`
    SELECT current_database() AS database, (SELECT count(*)::int FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND backend_type = 'client backend') AS clients
  `;
  assert.equal(isolation.database, url.pathname.slice(1));
  assert.equal(isolation.clients, 0, 'Stop foreign clients before fixture preparation');
  for (const model of [
    prisma.service,
    prisma.integration,
    prisma.user,
    prisma.ingestionReceipt,
    prisma.backgroundJob,
  ])
    assert.equal(await model.count(), 0, 'Stage profiling requires an empty dedicated fixture');
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: false },
    update: { automationEnabled: false },
  });
  const service = await prisma.service.create({
    data: { name: `Isolated ${stage} ${randomUUID()}` },
  });
  const { acceptPostgresEvent } = require('../../src/lib/ingestion/postgres');
  const { processEvent } = require('../../src/lib/events');
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < count) {
        const index = cursor++;
        const event = {
          event_action: 'trigger',
          dedup_key: `stage-${index}`,
          payload: {
            summary: 'Owned stage fixture',
            source: 'capacity-stage',
            severity: 'critical',
            custom_details: { body: randomBytes(7500).toString('base64') },
          },
        };
        if (stage === 'incident-only')
          await acceptPostgresEvent(
            {
              event,
              serviceId: service.id,
              integrationId: 'stage-fixture',
              integrationType: 'WEBHOOK',
              providerPayload: {},
              receivedAt: new Date(),
            },
            `stage-${index}`
          );
        else await processEvent(event, service.id, 'stage-fixture');
      }
    })
  );
  // No consumers exist yet. Hold fixtures until every owned image process is
  // ready, then publish in one database statement inside the measured window.
  if (stage === 'incident-only')
    await prisma.$executeRaw`UPDATE "IngestionReceipt" SET "availableAt" = clock_timestamp() + INTERVAL '1 day' WHERE "serviceId" = ${service.id}`;
  else
    await prisma.$executeRaw`UPDATE "BackgroundJob" SET "scheduledAt" = clock_timestamp() + INTERVAL '1 day'`;
  const expectedOutbox =
    count * (require('../../src/lib/event-outbox').getEventSideEffects('triggered').length + 1);
  if (stage === 'effects-only') assert.equal(await prisma.backgroundJob.count(), expectedOutbox);
  return {
    expectedOutbox,
    serviceId: service.id,
    count,
    stage,
    automationEnabled: false,
    payloadBytes: 10000,
    initialJobs: await prisma.backgroundJob.count(),
  };
}

async function snapshot(prisma, fixture) {
  if (fixture.stage === 'incident-only') {
    const [value] = await prisma.$queryRaw`
      SELECT /* ingestion_capacity_stage_snapshot */ COUNT(*)::int AS accepted,
        COUNT(*) FILTER (WHERE status = 'PENDING' AND attempts = 0 AND "processingStartedAt" IS NULL)::int AS unclaimed,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'DEAD')::int AS failed,
        COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED', 'ARCHIVED'))::int AS pending,
        (SELECT COUNT(*)::int FROM "Incident" WHERE "serviceId" = ${fixture.serviceId}) AS incidents,
        (SELECT COUNT(*)::int FROM "Alert" WHERE "serviceId" = ${fixture.serviceId}) AS alerts,
        (SELECT COUNT(*)::int FROM "BackgroundJob") AS "outboxJobs"
      FROM "IngestionReceipt" WHERE "serviceId" = ${fixture.serviceId}
    `;
    return value;
  }
  // Empty dedicated fixture: includes initial jobs and generated provider child
  // jobs, grouped by fixed database enum. No payloads/recipient identities leave.
  const jobs = await prisma.$queryRaw`
    SELECT /* ingestion_capacity_stage_snapshot */ job.type::text AS type, job.status::text AS status, COUNT(*)::int AS count, MAX(job.attempts)::int AS "maxAttemptsUsed"
    FROM "BackgroundJob" job
    WHERE job.payload->>'incidentId' IN (SELECT id FROM "Incident" WHERE "serviceId" = ${fixture.serviceId})
      OR (job.type = 'WAR_ROOM_PROVIDER_EVENT' AND job.payload->>'deliveryId' IN
        (SELECT id FROM "WarRoomProviderEventDelivery" WHERE "incidentId" IN
          (SELECT id FROM "Incident" WHERE "serviceId" = ${fixture.serviceId})))
    GROUP BY job.type, job.status ORDER BY job.type, job.status
  `;
  return {
    jobs,
    completed: jobs
      .filter(row => row.status === 'COMPLETED')
      .reduce((sum, row) => sum + row.count, 0),
    failed: jobs
      .filter(row => ['FAILED', 'CANCELLED'].includes(row.status))
      .reduce((sum, row) => sum + row.count, 0),
    pending: jobs
      .filter(row => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(row.status))
      .reduce((sum, row) => sum + row.count, 0),
  };
}

function stageComplete(fixture, value) {
  if (fixture.stage === 'incident-only')
    return (
      value.accepted === fixture.count &&
      value.completed === fixture.count &&
      value.incidents === fixture.count &&
      value.alerts === fixture.count &&
      value.outboxJobs === fixture.expectedOutbox &&
      value.pending === 0 &&
      value.failed === 0
    );
  return value.completed >= fixture.initialJobs && value.pending === 0 && value.failed === 0;
}

function stageUnclaimed(fixture, value) {
  if (fixture.stage === 'incident-only')
    return (
      value.accepted === fixture.count &&
      value.unclaimed === fixture.count &&
      value.incidents === 0 &&
      value.alerts === 0 &&
      value.outboxJobs === 0
    );
  return (
    value.jobs.reduce((sum, row) => sum + row.count, 0) === fixture.initialJobs &&
    value.jobs.every(row => row.status === 'PENDING' && row.maxAttemptsUsed === 0)
  );
}

async function measureStage(prisma, fixture, timeoutMs = 120000) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 3600000);
  assert.ok(
    stageUnclaimed(fixture, await snapshot(prisma, fixture)),
    'Fixture was consumed before the measured publication'
  );
  const finishProfile = await require('./database-profile.cjs')(prisma);
  const started = performance.now();
  const samples = [];
  let final;
  let fault;
  try {
    if (fixture.stage === 'incident-only')
      await prisma.$executeRaw`UPDATE "IngestionReceipt" SET "availableAt" = clock_timestamp() WHERE "serviceId" = ${fixture.serviceId}`;
    else
      await prisma.$executeRaw`UPDATE "BackgroundJob" SET "scheduledAt" = clock_timestamp() WHERE status = 'PENDING'`;
    while (performance.now() - started < timeoutMs) {
      final = await snapshot(prisma, fixture);
      samples.push({ elapsedMs: performance.now() - started, ...final });
      if (stageComplete(fixture, final) || final.failed > 0) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    fault = error.name;
  }
  const elapsedMs = performance.now() - started;
  const databaseProfile = await finishProfile();
  const passed = !fault && !!final && stageComplete(fixture, final);
  return {
    stage: fixture.stage,
    passed,
    certifiedEnterprise: false,
    fixture,
    elapsedMs,
    final,
    fault,
    samples,
    incidentUnitsPerSecond: passed ? (fixture.count * 1000) / elapsedMs : null,
    completedJobsPerSecond:
      fixture.stage === 'effects-only' && final ? (final.completed * 1000) / elapsedMs : null,
    databaseQueriesPerIncidentUnit: databaseProfile.totalQueryCalls / fixture.count,
    statementWalBytesPerIncidentUnit: databaseProfile.totalStatementWalBytes / fixture.count,
    databaseProfile,
    scope:
      'Native image consumers drain preloaded default critical-trigger fixtures. Preparation/readiness excluded; publish, monitoring and durable outbox writes included. Automation off, no users/integrations/external providers. CPU counters include diagnostic collection. Not HTTP, representative-provider delivery, sustained-load, mixed-workload or HA certification.',
  };
}
module.exports = {
  capacityStage,
  prepareStageFixture,
  measureStage,
  stageComplete,
  stageUnclaimed,
  cpuUsageDelta,
};
