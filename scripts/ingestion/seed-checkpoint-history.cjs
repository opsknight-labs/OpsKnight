/* eslint-disable @typescript-eslint/no-require-imports -- Executable CommonJS fixture seeder uses the shared TypeScript runtime. */
const assert = require('node:assert/strict');

function seedCounts(args) {
  const incidents = Number(args[0] ?? 100000);
  const jobs = Number(args[1] ?? 500000);
  assert.ok(Number.isSafeInteger(incidents) && incidents >= 1 && incidents <= 100000);
  assert.ok(Number.isSafeInteger(jobs) && jobs >= 1 && jobs <= 1000000);
  return { incidents, jobs };
}
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55445');
  assert.match(url.pathname, /^\/ingestion_test_http_checkpoint_[a-z0-9_]+$/);
  const counts = seedCounts(process.argv.slice(2));
  require('./isolated-runtime.cjs');
  const db = require('../../src/lib/prisma').default;
  try {
    assert.equal(await db.service.count(), 0, 'History seed requires empty owned fixture');
    assert.equal(await db.backgroundJob.count(), 0);
    assert.equal(await db.ingestionReceipt.count(), 0);
    const service = await db.service.create({
      data: { name: 'Owned synthetic checkpoint history' },
    });
    for (let first = 1; first <= counts.incidents; first += 5000) {
      const last = Math.min(counts.incidents, first + 4999);
      await db.$transaction(
        async tx => {
          await tx.$executeRaw`
          INSERT INTO "Incident" (id, title, description, status, urgency, "serviceId", "dedupKey", "createdAt", "updatedAt", "resolvedAt")
          SELECT 'checkpoint-aged-incident-' || n, 'Owned synthetic resolved incident',
            'Historical cardinality fixture; not representative production text',
            'RESOLVED'::"IncidentStatus", 'LOW'::"IncidentUrgency", ${service.id},
            'checkpoint-aged-key-' || n, clock_timestamp() - interval '36 hours',
            clock_timestamp() - interval '24 hours', clock_timestamp() - interval '24 hours'
          FROM generate_series(${first}::int, ${last}::int) n`;
          await tx.$executeRaw`
          INSERT INTO "Alert" (id, "serviceId", "incidentId", "dedupKey", status, payload, "createdAt")
          SELECT 'checkpoint-aged-alert-' || n, ${service.id}, 'checkpoint-aged-incident-' || n,
            'checkpoint-aged-key-' || n, 'RESOLVED',
            jsonb_build_object('fixture', true, 'ordinal', n, 'source', 'owned-history'),
            clock_timestamp() - interval '36 hours'
          FROM generate_series(${first}::int, ${last}::int) n`;
          await tx.$executeRaw`
          INSERT INTO "IncidentEvent" (id, "incidentId", message, "createdAt")
          SELECT 'checkpoint-aged-event-' || n, 'checkpoint-aged-incident-' || n,
            'Owned synthetic history', clock_timestamp() - interval '24 hours'
          FROM generate_series(${first}::int, ${last}::int) n`;
        },
        { timeout: 60000 }
      );
    }
    for (let first = 1; first <= counts.jobs; first += 5000) {
      const last = Math.min(counts.jobs, first + 4999);
      await db.$executeRaw`
        INSERT INTO "BackgroundJob" (id, type, status, "scheduledAt", "completedAt", payload, "createdAt", "updatedAt")
        SELECT 'checkpoint-aged-job-' || n, 'SCHEDULED_TASK'::"JobType", 'COMPLETED'::"JobStatus",
          clock_timestamp() - interval '36 hours', clock_timestamp() - interval '24 hours',
          jsonb_build_object('task', 'OWNED_COMPLETED_HISTORY', 'fixture', true, 'ordinal', n),
          clock_timestamp() - interval '36 hours', clock_timestamp() - interval '24 hours'
        FROM generate_series(${first}::int, ${last}::int) n`;
    }
    const actual = {
      incidents: await db.incident.count(),
      alerts: await db.alert.count(),
      events: await db.incidentEvent.count(),
      jobs: await db.backgroundJob.count(),
    };
    assert.deepEqual(actual, {
      incidents: counts.incidents,
      alerts: counts.incidents,
      events: counts.incidents,
      jobs: counts.jobs,
    });
    console.log(
      JSON.stringify({
        actual,
        serviceId: service.id,
        database: url.pathname.slice(1),
        scope:
          'Synthetic 24–36h-old resolved history, narrow fixture payloads. Cardinality/index test only, no production churn/bloat, configured-provider or retention certificate.',
      })
    );
  } finally {
    await db.$disconnect();
  }
}
module.exports = { seedCounts };
if (require.main === module)
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
