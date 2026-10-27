require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const prisma = require('../../src/lib/prisma').default;
const {
  acceptIntegrationEvent,
  withIngestionDelivery,
} = require('../../src/lib/ingestion/admission');
const { claimPostgresEvents } = require('../../src/lib/ingestion/postgres');
const { consumeIngestionBatch } = require('../../src/lib/ingestion/worker');
const { IngestionUnavailableError } = require('../../src/lib/ingestion/contract');
const docker = '/Applications/Docker.app/Contents/Resources/bin/docker';
const container = 'opsknight-ingestion-cert-db';
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.port, '55445');
assert.equal(database.pathname, '/ingestion_test_outage');
let stopped = false;
async function main() {
  const service = await prisma.service.create({ data: { name: `Outage fixture ${randomUUID()}` } });
  function input(index) {
    return {
      serviceId: service.id,
      integrationId: 'outage-fixture',
      integrationType: 'WEBHOOK',
      receivedAt: new Date(),
      providerPayload: {},
      event: {
        event_action: 'trigger',
        dedup_key: `outage-${index}`,
        payload: { summary: 'Outage fixture', source: 'fixture', severity: 'critical' },
      },
    };
  }
  async function accept(index) {
    return withIngestionDelivery(`outage-${index}`, () => acceptIntegrationEvent(input(index)));
  }
  const receipts = [];
  for (let i = 0; i < 20; i++) receipts.push(await accept(i));
  const [abandoned] = await claimPostgresEvents(1);
  assert.ok(abandoned);
  assert.equal(
    (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: abandoned.id } })).serviceId,
    service.id,
    'Natural recovery must exercise the receipt claimed by this fixture'
  );
  const leaseClaimedAt = performance.now();
  execFileSync(docker, ['stop', '--time', '0', container], { stdio: 'inherit' });
  stopped = true;
  await assert.rejects(accept(20), error => error instanceof IngestionUnavailableError);
  execFileSync(docker, ['start', container], { stdio: 'inherit' });
  stopped = false;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      ready = true;
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  assert.ok(ready, 'Database did not recover');
  assert.equal(await prisma.ingestionReceipt.count({ where: { serviceId: service.id } }), 20);
  receipts.push(await accept(20));
  const recoveryDeadline = Date.now() + 120000;
  while (Date.now() < recoveryDeadline) {
    await consumeIngestionBatch(4);
    if (!(await prisma.ingestionReceipt.count({
      where: { serviceId: service.id, status: { not: 'COMPLETED' } },
    }))) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const naturalRecoveryMs = performance.now() - leaseClaimedAt;
  for (let i = 0; i <= 20; i++) await accept(i);
  assert.equal(await consumeIngestionBatch(4), 0);
  const [completed, alerts, incidents, pending] = await Promise.all([
    prisma.ingestionReceipt.count({ where: { serviceId: service.id, status: 'COMPLETED' } }),
    prisma.alert.count({ where: { serviceId: service.id } }),
    prisma.incident.count({ where: { serviceId: service.id } }),
    prisma.ingestionReceipt.count({
      where: { serviceId: service.id, status: { not: 'COMPLETED' } },
    }),
  ]);
  assert.equal(completed, 21);
  assert.equal(alerts, 21);
  assert.equal(incidents, 21);
  assert.equal(pending, 0);
  const evidence = {
    measuredAt: new Date().toISOString(),
    runtime: process.version,
    scope:
      'Isolated local PostgreSQL container forced termination and restart; not replicated database failover',
    durablyAcceptedBeforeOutage: 20,
    unavailableAdmissionRejected: true,
    acceptedAfterRecovery: 1,
    completed,
    alerts,
    incidents,
    pending,
    duplicateDeliveriesReconciled: true,
    abandonedLeaseRecovered: true,
    leaseExpiryAdvanced: false,
    naturalRecoveryMs,
    leaseRecovery: 'Real 60-second database-clock lease expiry; no receipt timestamps changed',
    certifiedEnterprise: false,
  };
  writeFileSync(
    'plans/event-ingestion/local-database-outage-natural.json',
    JSON.stringify(evidence, null, 2) + '\n'
  );
  console.log('Local database outage and restart reconciliation passed.');
}
main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (stopped) execFileSync(docker, ['start', container], { stdio: 'inherit' });
    await prisma.$disconnect();
  });
